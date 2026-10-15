import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceOrderPayment } from './useMarketplaceOrderPayment';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    refreshShop: vi.fn(async (sellerPubky: string) => ({ ownerPubky: sellerPubky })),
    getShop: vi.fn(async () => null),
    fetchUsdtPaymentsAvailable: vi.fn(async () => false),
    getDeliveryAddresses: vi.fn(async () => []),
    commitMarkDeliveryAddressUsed: vi.fn(async () => undefined),
    resolveDeliveryKeysForCheckout: vi.fn(),
    commitAcceptDeliveryKeyChange: vi.fn(),
    sealDeliveryAddressForCheckout: vi.fn(),
    rememberUsdtRefusal: vi.fn((sellerKey: string, reason: 'usdt_unavailable' | 'usdt_seller_not_ready') => {
      useCommerceStore.getState().setUsdtRefusal(sellerKey, reason);
    }),
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
      await result.current.bind('bitcoin');
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
      await result.current.bind('bitcoin');
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
    expect(CommerceController.bindPaymentMethod).toHaveBeenLastCalledWith(order.id, 'bitcoin', undefined);
    await waitFor(() => expect(onPaymentChanged).toHaveBeenCalledTimes(1));
  });

  describe('a Paykit outage', () => {
    const outage = {
      bitcoinAvailable: false,
      bitcoinOfferAvailable: false,
      paypalAvailable: false,
      paykitUnreachable: true,
    };
    const healthy = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false };
    const paykitDown = () =>
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
        message: 'SENTINEL_PAYKIT_503',
        service: ErrorService.Marketplace,
        operation: 'bindPaymentMethod',
        context: { statusCode: 503, reason: 'paykit_unavailable' },
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('flags the outage, keeps checking and offers Bitcoin again when Paykit is back', async () => {
      vi.useFakeTimers();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(outage).mockResolvedValue(healthy);
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({
          order: createOrderFixture('pending_payment'),
          enabled: true,
          onPaymentChanged: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.paykitOutage).toBe(true);
      expect(result.current.availableMethods).toEqual([]);
      expect(result.current.bitcoinOfferUnavailable).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(result.current.paykitOutage).toBe(false);
      expect(result.current.availableMethods).toEqual(['bitcoin']);
      expect(result.current.bitcoinOfferUnavailable).toBe(false);
    });

    it('treats a refused bind as an outage even when the health read looked fine, then re-enables on its own', async () => {
      vi.useFakeTimers();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(healthy);
      vi.mocked(CommerceController.bindPaymentMethod).mockReset();
      vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(paykitDown());
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({
          order: createOrderFixture('pending_payment'),
          enabled: true,
          onPaymentChanged: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.paykitOutage).toBe(false);

      await act(async () => {
        await result.current.bind('bitcoin');
      });
      const toastCall = vi.mocked(toast).mock.calls.at(-1)?.[0];
      expect(toastCall?.description).toBe('Paykit is temporarily unreachable, retrying…');
      expect(JSON.stringify(toastCall)).not.toContain('SENTINEL');
      expect(result.current.paykitOutage).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(result.current.paykitOutage).toBe(false);
    });

    it('keeps the refused-bind outage while the recheck is in flight, so Bitcoin stays disabled until it finds Paykit reachable', async () => {
      vi.useFakeTimers();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(healthy);
      vi.mocked(CommerceController.bindPaymentMethod).mockReset();
      vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(paykitDown());
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({
          order: createOrderFixture('pending_payment'),
          enabled: true,
          onPaymentChanged: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await result.current.bind('bitcoin');
      });
      expect(result.current.paykitOutage).toBe(true);

      let finishRead: (config: typeof healthy) => void = () => {};
      vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRead = resolve as typeof finishRead;
          }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(result.current.paykitOutage).toBe(true);
      expect(result.current.availableMethods).toEqual(['bitcoin']);

      await act(async () => {
        finishRead(healthy);
      });
      expect(result.current.paykitOutage).toBe(false);
    });

    it('keeps retrying after the first config read fails, and loads the methods on its own', async () => {
      vi.useFakeTimers();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
      vi.mocked(CommerceController.getSellerPaymentConfig)
        .mockRejectedValueOnce(appError('SENTINEL_ORDER_PAYMENT_CONFIG'))
        .mockResolvedValue(healthy);
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({
          order: createOrderFixture('pending_payment'),
          enabled: true,
          onPaymentChanged: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.configError).toBeTypeOf('string');
      expect(result.current.availableMethods).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(result.current.configError).toBeNull();
      expect(result.current.availableMethods).toEqual(['bitcoin']);
    });

    it('stays in the outage when the recheck still finds Paykit unreachable, and backs off', async () => {
      vi.useFakeTimers();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(outage);
      const { result } = renderHook(() =>
        useMarketplaceOrderPayment({
          order: createOrderFixture('pending_payment'),
          enabled: true,
          onPaymentChanged: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      vi.mocked(CommerceController.getSellerPaymentConfig).mockClear();

      for (const delay of [5_000, 10_000, 20_000, 30_000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }

      expect(result.current.paykitOutage).toBe(true);
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(4);
    });
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
        await result.current.bind('bitcoin');
      });

      expect(CommerceController.sealDeliveryAddressForCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ checkoutCommandId: order.id, address: ADDRESS }),
      );
      expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(order.id, 'bitcoin', {
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

  describe('USDT in the method picker', () => {
    const config = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: true, usdtAvailable: true };
    const renderPicker = (order = createOrderFixture('pending_payment', { paymentMethod: null })) =>
      renderHook(() => useMarketplaceOrderPayment({ order, enabled: true, onPaymentChanged: vi.fn() }));

    it('offers usdt when the gate is on, the seller offers it and the order is USD-priced', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const { result } = renderPicker();

      await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'usdt', 'paypal']));
    });

    it('does not offer usdt while the gate is off', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const { result } = renderPicker();

      await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'paypal']));
    });

    it('does not offer usdt on a Bitcoin-priced order', async () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValueOnce(config);
      const order = createOrderFixture('pending_payment', {
        paymentMethod: null,
        total: { amountMinor: 150_000, currency: 'BTC', exponent: 8 },
      });
      const { result } = renderPicker(order);

      await waitFor(() => expect(CommerceController.fetchUsdtPaymentsAvailable).toHaveBeenCalled());
      await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'paypal']));
    });

    describe('after a refused USDT bind', () => {
      const usdtBindRefusal = (reason: string) =>
        new AppError({
          category: ErrorCategory.Client,
          code: ClientErrorCode.BAD_REQUEST,
          message: 'SENTINEL',
          service: ErrorService.Marketplace,
          operation: 'bindPaymentMethod',
          context: { statusCode: 409, reason, paymentMethod: 'usdt' },
        });

      afterEach(() => {
        useCommerceStore.getState().reset();
      });

      it.each(['usdt_unavailable', 'usdt_seller_not_ready'] as const)(
        'drops Continue with USDT after %s, shows the copy once, and keeps Bitcoin and PayPal',
        async (reason) => {
          vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
          vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(config);
          vi.mocked(CommerceController.bindPaymentMethod).mockReset();
          vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(usdtBindRefusal(reason));
          vi.mocked(toast).mockClear();
          const order = createOrderFixture('pending_payment', { paymentMethod: null });
          const { result } = renderPicker(order);
          await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'usdt', 'paypal']));

          await act(async () => {
            await result.current.bind('usdt');
          });

          await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'paypal']));
          expect(vi.mocked(toast)).toHaveBeenCalledTimes(1);
          expect(useCommerceStore.getState().usdtRefusals).toEqual({ [order.sellerPubky]: reason });
        },
      );

      it('keeps offering USDT after a refusal the buyer or a retry can fix', async () => {
        vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
        vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(config);
        vi.mocked(CommerceController.bindPaymentMethod).mockReset();
        vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(
          usdtBindRefusal('buyer_usdt_wallet_required'),
        );
        const { result } = renderPicker();
        await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'usdt', 'paypal']));

        await act(async () => {
          await result.current.bind('usdt');
        });

        expect(result.current.availableMethods).toEqual(['bitcoin', 'usdt', 'paypal']);
        expect(useCommerceStore.getState().usdtRefusals).toEqual({});
      });

      it("offers USDT for another seller's order", async () => {
        vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
        vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue(config);
        useCommerceStore.getState().setUsdtRefusal('z'.repeat(52), 'usdt_unavailable');
        const { result } = renderPicker();

        await waitFor(() => expect(result.current.availableMethods).toEqual(['bitcoin', 'usdt', 'paypal']));
      });
    });

    it('never reads the capability for an order that is already bound', () => {
      vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockClear();
      renderPicker(createOrderFixture('pending_payment', { paymentMethod: 'bitcoin' }));

      expect(CommerceController.fetchUsdtPaymentsAvailable).not.toHaveBeenCalled();
    });
  });
});
