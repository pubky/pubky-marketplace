import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELLER_AUTO_CONFIRM_REASON } from '@/libs/commerce/seller-auto-confirm';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { CommerceApplication } from './commerce';

const SELLER = 's'.repeat(52);

const bitcoin = createOrderFixture('pending_payment', {
  id: '00000000-0000-4000-8000-000000000001',
  sellerPubky: SELLER,
  paymentMethod: 'paykit',
  paykitRequestState: 'awaiting_seller_confirmation',
});
const paypal = createOrderFixture('pending_payment', {
  id: '00000000-0000-4000-8000-000000000002',
  sellerPubky: SELLER,
  paymentMethod: 'paypal',
  gatewayPaymentSeenAt: '2026-10-28T09:00:00.000Z',
});
const short = createOrderFixture('pending_payment', {
  id: '00000000-0000-4000-8000-000000000003',
  sellerPubky: SELLER,
  paymentMethod: 'paykit',
  paykitRequestState: 'awaiting_seller_confirmation',
});
const unrelated = createOrderFixture('paid', { id: '00000000-0000-4000-8000-000000000004', sellerPubky: SELLER });

describe('CommerceApplication.autoConfirmSellerPayments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubService() {
    vi.spyOn(MarketplaceGatewayService, 'getOrders').mockResolvedValue([bitcoin, paypal, short, unrelated]);
    const full = new Map([
      [bitcoin.id, { ...bitcoin, paykitObservation: { amountMatched: true, disappeared: false } }],
      [paypal.id, paypal],
      [short.id, { ...short, paykitObservation: { amountMatched: false } }],
    ]);
    const getOrder = vi
      .spyOn(MarketplaceGatewayService, 'getOrder')
      .mockImplementation(async (_actor, orderId) => full.get(orderId) ?? null);
    const confirmPaykit = vi
      .spyOn(MarketplaceGatewayService, 'confirmBitcoinPayment')
      .mockResolvedValue({ order: null, confirmation: {} as never });
    const confirmPaypal = vi.spyOn(MarketplaceGatewayService, 'confirmFiatReceived').mockResolvedValue(paypal);
    return { getOrder, confirmPaykit, confirmPaypal };
  }

  it('confirms, as the seller, each matching payment on its own rail and leaves the rest', async () => {
    const { getOrder, confirmPaykit, confirmPaypal } = stubService();

    await expect(CommerceApplication.autoConfirmSellerPayments(SELLER)).resolves.toEqual([bitcoin.id, paypal.id]);
    expect(getOrder).toHaveBeenCalledTimes(3);
    expect(getOrder).not.toHaveBeenCalledWith(SELLER, unrelated.id);
    expect(confirmPaykit).toHaveBeenCalledTimes(1);
    expect(confirmPaykit).toHaveBeenCalledWith(SELLER, bitcoin.id, SELLER_AUTO_CONFIRM_REASON);
    expect(confirmPaypal).toHaveBeenCalledTimes(1);
    expect(confirmPaypal).toHaveBeenCalledWith(SELLER, paypal.id);
  });

  it('keeps going past a confirmation the service refuses', async () => {
    const { confirmPaykit, confirmPaypal } = stubService();
    confirmPaykit.mockRejectedValueOnce(new Error('order_not_awaiting_confirmation'));

    await expect(CommerceApplication.autoConfirmSellerPayments(SELLER)).resolves.toEqual([paypal.id]);
    expect(confirmPaypal).toHaveBeenCalledTimes(1);
  });
});
