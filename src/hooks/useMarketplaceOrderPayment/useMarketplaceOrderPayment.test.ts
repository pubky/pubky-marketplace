import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceOrderPayment } from './useMarketplaceOrderPayment';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    fetchUsdtPaymentsAvailable: vi.fn(async () => false),
    getDeliveryAddresses: vi.fn(async () => []),
    commitMarkDeliveryAddressUsed: vi.fn(async () => undefined),
    resolveDeliveryKeysForCheckout: vi.fn(),
    commitAcceptDeliveryKeyChange: vi.fn(),
    sealDeliveryAddressForCheckout: vi.fn(),
    getSellerPaymentConfig: vi.fn(),
    bindPaymentMethod: vi.fn(),
    markFiatPaid: vi.fn(),
    confirmFiatReceived: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

const appError = (message: string, reason?: string) =>
  new AppError({
    category: ErrorCategory.Client,
    code: ClientErrorCode.CONFLICT,
    message,
    service: ErrorService.Marketplace,
    operation: 'payment',
    ...(reason ? { context: { reason, statusCode: 409 } } : {}),
  });

describe('useMarketplaceOrderPayment', () => {
  it('uses static copy when loading seller payment configuration fails', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockRejectedValueOnce(
      appError('SENTINEL_ORDER_PAYMENT_CONFIG'),
    );
    const { result } = renderHook(() =>
      useMarketplaceOrderPayment({ order: createOrderFixture('paid'), enabled: true, onPaymentChanged: vi.fn() }),
    );

    await waitFor(() => expect(result.current.configError).toBeTypeOf('string'));
    expect(result.current.configError).toBeTruthy();
    expect(result.current.configError).not.toContain('SENTINEL_ORDER_PAYMENT_CONFIG');
  });

  it('uses static copy when a payment action fails', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });
    vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(appError('SENTINEL_ORDER_PAYMENT_ACTION'));
    const { result } = renderHook(() =>
      useMarketplaceOrderPayment({ order: createOrderFixture('paid'), enabled: true, onPaymentChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.bind('paykit');
    });
    const toastCall = vi.mocked(toast).mock.calls.at(-1)?.[0];
    expect(toastCall?.variant).toBe('error');
    expect(toastCall?.description).toBeTypeOf('string');
    expect(toastCall?.description).not.toContain('SENTINEL_ORDER_PAYMENT_ACTION');
  });

  it('surfaces the service refusal reason on an error toast', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: true,
    });
    vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(
      appError('SENTINEL_ORDER_PAYMENT_ACTION', 'method_unavailable'),
    );
    const { result } = renderHook(() =>
      useMarketplaceOrderPayment({ order: createOrderFixture('paid'), enabled: true, onPaymentChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.bind('paypal');
    });
    const toastCall = vi.mocked(toast).mock.calls.at(-1)?.[0];
    expect(toastCall?.variant).toBe('error');
    expect(toastCall?.description).toBe('The seller has not configured this payment method.');
    expect(toastCall?.description).not.toContain('SENTINEL');
  });

  it('asks the buyer to finish reader wallet setup and binds again only when they choose Try again', async () => {
    const order = createOrderFixture('paid');
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });
    vi.mocked(CommerceController.bindPaymentMethod).mockReset();
    vi.mocked(CommerceController.bindPaymentMethod)
      .mockRejectedValueOnce(appError('SENTINEL_ORDER_PAYMENT_ACTION', 'buyer_paykit_wallet_setup_needed'))
      .mockResolvedValueOnce(order);
    const onPaymentChanged = vi.fn();
    const { result } = renderHook(() => useMarketplaceOrderPayment({ order, enabled: true, onPaymentChanged }));

    await act(async () => {
      await result.current.bind('paykit');
    });
    const toastCall = vi.mocked(toast).mock.calls.at(-1)?.[0];
    expect(toastCall).toMatchObject({
      variant: 'error',
      title: 'Reader wallet setup needed',
      description: 'Finish setting up Bitkit (or another Paykit wallet) for this pubky, then try again.',
      duration: 60_000,
    });
    expect(JSON.stringify(toastCall)).not.toContain('SENTINEL');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(CommerceController.bindPaymentMethod).toHaveBeenCalledTimes(1);
    expect(onPaymentChanged).not.toHaveBeenCalled();

    await act(async () => {
      asOpaque<{ props: { onClick: () => void } }>(toastCall?.action).props.onClick();
    });
    await waitFor(() => expect(CommerceController.bindPaymentMethod).toHaveBeenCalledTimes(2));
    expect(CommerceController.bindPaymentMethod).toHaveBeenLastCalledWith(order.id, 'paykit', undefined);
    await waitFor(() => expect(onPaymentChanged).toHaveBeenCalledTimes(1));
  });

  describe('an auction winner order that still needs its delivery address', () => {
    const SELLER_KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32) };
    const ADDRESS = {
      name: 'Ada Buyer',
      line1: '1 Example Street',
      line2: '',
      city: 'Lisbon',
      region: '',
      postalCode: '1000-001',
      countryCode: 'PT',
    };
    const config = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: true };
    const winnerOrder = (overrides = {}) =>
      createOrderFixture('pending_payment', {
        paymentMethod: null,
        auctionAggregateId: 'listing:seller_boots',
        shippingAddressRequired: true,
        ...overrides,
      });

    beforeEach(() => {
      vi.mocked(CommerceController.bindPaymentMethod).mockReset();
      vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
        ok: true,
        keys: new Map([[createOrderFixture('paid').sellerPubky, SELLER_KEY]]),
      });
      vi.mocked(CommerceController.sealDeliveryAddressForCheckout).mockResolvedValue([
        { sellerPubky: createOrderFixture('paid').sellerPubky, keyId: SELLER_KEY.keyId, envelope: 'E'.repeat(2795) },
      ]);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(config);
    });

    it('exposes the address form and binds with the sealed address, bound to the order id', async () => {
      const order = winnerOrder();
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({ order, enabled: true, onPaymentChanged: vi.fn() }),
      );
      expect(result.current.deliveryAddress).not.toBeNull();
      act(() => {
        result.current.deliveryAddress?.form.reset(ADDRESS);
      });

      await act(async () => {
        await result.current.bind('paykit');
      });

      expect(CommerceController.sealDeliveryAddressForCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ checkoutCommandId: order.id, address: ADDRESS }),
      );
      expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(order.id, 'paykit', {
        deliveryAddressEnvelope: { keyId: SELLER_KEY.keyId, envelope: 'E'.repeat(2795) },
      });
    });

    it('does not bind while the address is incomplete', async () => {
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({ order: winnerOrder(), enabled: true, onPaymentChanged: vi.fn() }),
      );

      await act(async () => {
        await result.current.bind('paypal');
      });

      expect(CommerceController.bindPaymentMethod).not.toHaveBeenCalled();
      expect(result.current.pendingAction).toBeNull();
    });

    it('does not bind when the seller published no delivery key', async () => {
      vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
        ok: false,
        sellerPubky: createOrderFixture('paid').sellerPubky,
        problem: { kind: 'no_key' },
      });
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({ order: winnerOrder(), enabled: true, onPaymentChanged: vi.fn() }),
      );
      act(() => {
        result.current.deliveryAddress?.form.reset(ADDRESS);
      });

      await act(async () => {
        await result.current.bind('paypal');
      });

      expect(CommerceController.bindPaymentMethod).not.toHaveBeenCalled();
      expect(result.current.deliveryAddress?.deliveryKeyBlock?.kind).toBe('no_key');
    });

    it('sends no address for an order that already has one', async () => {
      const order = winnerOrder({ shippingAddressRequired: false });
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({ order, enabled: true, onPaymentChanged: vi.fn() }),
      );
      expect(result.current.deliveryAddress).toBeNull();

      await act(async () => {
        await result.current.bind('paypal');
      });

      expect(CommerceController.sealDeliveryAddressForCheckout).not.toHaveBeenCalled();
      expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(order.id, 'paypal', undefined);
    });

    it('tells the winner when the window to pay has ended', async () => {
      vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(
        appError('SENTINEL_ORDER_PAYMENT_ACTION', 'auction_window_ended'),
      );
      vi.mocked(toast).mockClear();
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({ order: winnerOrder(), enabled: true, onPaymentChanged: vi.fn() }),
      );
      act(() => {
        result.current.deliveryAddress?.form.reset(ADDRESS);
      });

      await act(async () => {
        await result.current.bind('paypal');
      });

      const toastCall = vi.mocked(toast).mock.calls.at(-1)?.[0];
      expect(toastCall?.description).toBe('Your window to pay for this auction has ended.');
    });
  });

  describe('Paykit in the method picker', () => {
    const config = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: true, usdtAvailable: true };
    const renderPicker = (order = createOrderFixture('pending_payment', { paymentMethod: null })) =>
      renderHook(() => useMarketplaceOrderPayment({ order, enabled: true, onPaymentChanged: vi.fn() }));

    it('offers one Paykit entry for Bitcoin or USDT when the gate is on and the seller offers USDT', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const { result } = renderPicker();

      await waitFor(() => expect(result.current.availableMethods).toEqual(['paykit', 'paypal']));
      expect(result.current.paykitAssets).toEqual(['BTC', 'USDT']);
    });

    it('names Bitcoin only while the gate is off', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const { result } = renderPicker();

      await waitFor(() => expect(result.current.availableMethods).toEqual(['paykit', 'paypal']));
      expect(result.current.paykitAssets).toEqual(['BTC']);
    });

    it('offers USDT on a Bitcoin-priced order too, since the service fixes the rate', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const order = createOrderFixture('pending_payment', {
        paymentMethod: null,
        total: { amountMinor: 150_000, currency: 'BTC', exponent: 8 },
      });
      const { result } = renderPicker(order);

      await waitFor(() => expect(result.current.paykitAssets).toEqual(['BTC', 'USDT']));
    });

    it('binds the single Paykit method', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      vi.mocked(CommerceController.bindPaymentMethod).mockReset();
      const order = createOrderFixture('pending_payment', { paymentMethod: null });
      const { result } = renderPicker(order);
      await waitFor(() => expect(result.current.availableMethods).toEqual(['paykit', 'paypal']));

      await act(async () => {
        await result.current.bind('paykit');
      });

      expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(order.id, 'paykit', undefined);
    });

    it('never reads the capability for an order that is already bound', () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockClear();
      renderPicker(createOrderFixture('pending_payment', { paymentMethod: 'paykit' }));

      expect(CommerceController.fetchUsdtPaymentsAvailable).not.toHaveBeenCalled();
    });
  });
});
