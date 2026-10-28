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

const live = new AbortController().signal;

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

    await expect(CommerceApplication.autoConfirmSellerPayments(SELLER, () => true, live)).resolves.toEqual([
      bitcoin.id,
      paypal.id,
    ]);
    expect(getOrder).toHaveBeenCalledTimes(3);
    expect(getOrder).not.toHaveBeenCalledWith(SELLER, unrelated.id);
    expect(confirmPaykit).toHaveBeenCalledTimes(1);
    expect(confirmPaykit).toHaveBeenCalledWith(SELLER, bitcoin.id, SELLER_AUTO_CONFIRM_REASON, { signal: live });
    expect(confirmPaypal).toHaveBeenCalledTimes(1);
    expect(confirmPaypal).toHaveBeenCalledWith(SELLER, paypal.id, { signal: live });
  });

  it('keeps going past a confirmation the service refuses', async () => {
    const { confirmPaykit, confirmPaypal } = stubService();
    confirmPaykit.mockRejectedValueOnce(new Error('order_not_awaiting_confirmation'));

    await expect(CommerceApplication.autoConfirmSellerPayments(SELLER, () => true, live)).resolves.toEqual([paypal.id]);
    expect(confirmPaypal).toHaveBeenCalledTimes(1);
  });

  it('confirms nothing more once the seller turns the setting off mid-pass', async () => {
    const { confirmPaykit, confirmPaypal } = stubService();
    let enabled = true;
    confirmPaykit.mockImplementationOnce(async () => {
      enabled = false;
      return { order: null, confirmation: {} as never };
    });

    await expect(CommerceApplication.autoConfirmSellerPayments(SELLER, () => enabled, live)).resolves.toEqual([
      bitcoin.id,
    ]);
    expect(confirmPaykit).toHaveBeenCalledTimes(1);
    expect(confirmPaypal).not.toHaveBeenCalled();
  });

  it('ends the pass once its signal aborts, even while a confirmation never answers', async () => {
    const { confirmPaykit, confirmPaypal } = stubService();
    const pass = new AbortController();
    confirmPaykit.mockImplementationOnce(
      (_actor, _orderId, _reason, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const result = CommerceApplication.autoConfirmSellerPayments(SELLER, () => true, pass.signal);
    await vi.waitFor(() => expect(confirmPaykit).toHaveBeenCalledTimes(1));
    pass.abort();

    await expect(result).resolves.toEqual([]);
    expect(confirmPaypal).not.toHaveBeenCalled();
  });
});
