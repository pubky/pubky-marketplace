import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { MARKETPLACE_FAILURE_MESSAGES } from '@/libs/commerce/failure-messages';
import { PAYMENT_NOT_FINAL_COPY } from '@/libs/commerce/usdt-buyer-status';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { USDT_WIRE_PAYMENT_NOT_FINAL_REFUSAL } from '@/test/fixtures/commerce/usdt-orders';
import { useMarketplaceOrders } from './useMarketplaceOrders';

const BUYER = 'b'.repeat(52);
const SELLER = 'y'.repeat(52);
const PAYMENT_ID = '00000000-0000-4000-8000-000000001110';

const config = vi.hoisted(() => ({
  mode: 'sandbox' as string,
}));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommercePollIntervalMs: () => 60_000, getCommerceAdapterMode: () => config.mode };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: BUYER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMarketplaceOrders: vi.fn(),
    getMarketplacePayment: vi.fn(),
    getMarketplaceReceipt: vi.fn(),
    executeMarketplaceCommand: vi.fn(),
    // Own-review publication (trust & reputation P1.6): the load path resumes
    // pending publications and review commands publish the record.
    resumeOwnReviewPublications: vi.fn(async () => 0),
    sweepOwnAuctionReserves: vi.fn(async () => 0),
    publishOrderReceipts: vi.fn(async () => undefined),
    resumeOwnReviewResponsePublications: vi.fn(async () => 0),
    publishOwnMarketplaceReviews: vi.fn(async () => []),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn() },
}));

/** The exact error shape the durable transport throws for a missing or 401-rejected session. */
const sessionRequiredError = () =>
  new AppError({
    category: ErrorCategory.Auth,
    code: AuthErrorCode.SESSION_EXPIRED,
    message: 'SENTINEL_SESSION_TEXT_orders',
    service: ErrorService.Marketplace,
    operation: 'getOrders',
  });

describe('useMarketplaceOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
    useCommerceStore.getState().reset();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000001111');
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000001112',
        buyerPubky: BUYER,
        sellerPubky: SELLER,
        revision: 1,
        state: 'pending_payment',
        lines: [
          {
            listingAggregateId: `listing:${SELLER}_boots`,
            listingRevision: 1,
            contentHash: 'a'.repeat(64),
            title: 'Boots',
            quantity: 1,
            unitPrice: { amountMinor: 10_000, currency: 'USD', exponent: 2 },
            subtotal: { amountMinor: 10_000, currency: 'USD', exponent: 2 },
          },
        ],
        subtotal: { amountMinor: 10_000, currency: 'USD', exponent: 2 },
        shipping: { amountMinor: 1_200, currency: 'USD', exponent: 2 },
        total: { amountMinor: 11_200, currency: 'USD', exponent: 2 },
        paymentId: PAYMENT_ID,
        receiptId: null,
        fulfillment: 'shipping',
        deliveryAssumed: false,
        nextActor: 'buyer',
        createdAt: '2026-08-19T23:00:00.000Z',
        updatedAt: '2026-08-19T23:00:00.000Z',
      },
    ]);
    vi.mocked(CommerceController.getMarketplacePayment).mockResolvedValue({
      id: PAYMENT_ID,
      orderId: '00000000-0000-4000-8000-000000001112',
      buyerPubky: BUYER,
      sellerPubky: SELLER,
      revision: 1,
      adapter: 'sandbox',
      state: 'awaiting_entitlement',
      confirmations: 0,
      locksBundleId: '00000000-0000-4000-8000-000000001113',
      amount: { amountMinor: 11_200, currency: 'USD', exponent: 2 },
      createdAt: '2026-08-19T23:00:00.000Z',
      updatedAt: '2026-08-19T23:00:00.000Z',
    });
    vi.mocked(CommerceController.getMarketplaceReceipt).mockResolvedValue(null);
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000001111',
      aggregateId: `payment:${PAYMENT_ID}`,
      revision: 2,
      eventIds: ['00000000-0000-4000-8000-000000001114'],
      result: { kind: 'payment' },
    });
  });

  it('loads participant order/payment views and advances sandbox confirmation', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const payment = result.current.orders[0].payment!;

    await act(() => result.current.advancePayment(payment, 'confirmed', 1));

    expect(CommerceController.executeMarketplaceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: `payment:${PAYMENT_ID}`,
        expectedRevision: 1,
        kind: 'payment.sandbox_advance',
        payload: { paymentId: PAYMENT_ID, target: 'confirmed', confirmations: 1 },
      }),
    );
  });

  it('maps server and thrown sentinel failures to static copy', async () => {
    const sentinel = 'SENTINEL_SERVER_TEXT_orders';
    const { toast } = await import('@/molecules/Toaster/use-toast');
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const payment = result.current.orders[0].payment!;

    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: sentinel },
    });
    await act(async () => {
      await result.current.advancePayment(payment, 'confirmed', 1);
    });
    expect(vi.mocked(toast).mock.calls[0]?.[0]?.description).toBeTypeOf('string');
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(sentinel);

    vi.mocked(CommerceController.executeMarketplaceCommand).mockRejectedValueOnce(
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.CONFLICT,
        message: sentinel,
        service: ErrorService.Marketplace,
        operation: 'advancePayment',
      }),
    );
    await act(async () => {
      await result.current.advancePayment(payment, 'confirmed', 1);
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(sentinel);
  });

  it('loads nothing and never queries projections in unavailable mode', async () => {
    config.mode = 'unavailable';

    const { result } = renderHook(() => useMarketplaceOrders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.orders).toHaveLength(0);
    expect(result.current.adapterMode).toBe('unavailable');
    expect(CommerceController.getMarketplaceOrders).not.toHaveBeenCalled();
    expect(CommerceController.getMarketplacePayment).not.toHaveBeenCalled();
  });

  // locks-paykit composes with the durable transport, so order timelines load
  // there — but simulated payment advancement stays refused exactly as in
  // transaction-service mode.
  it('loads orders in locks-paykit mode and still refuses simulated advancement', async () => {
    config.mode = 'locks-paykit';

    const { result } = renderHook(() => useMarketplaceOrders());

    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const payment = result.current.orders[0].payment!;

    await act(() => result.current.advancePayment(payment, 'confirmed', 1));

    expect(CommerceController.executeMarketplaceCommand).not.toHaveBeenCalled();
  });

  it('refreshes durable orders from embedded payment without an extra payment fetch', async () => {
    config.mode = 'transaction-service';
    const [sandboxOrder] = await CommerceController.getMarketplaceOrders();
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([
      {
        ...sandboxOrder,
        // The durable read embeds the payment (without locksBundleId, per
        // ADR-0019 §8) instead of serving it from a separate endpoint.
        payment: {
          id: PAYMENT_ID,
          orderId: sandboxOrder.id,
          buyerPubky: BUYER,
          sellerPubky: SELLER,
          revision: 1,
          adapter: 'sandbox',
          state: 'awaiting_entitlement',
          confirmations: 0,
          amount: { amountMinor: 11_200, currency: 'USD', exponent: 2 },
          createdAt: '2026-08-19T23:00:00.000Z',
          updatedAt: '2026-08-19T23:00:00.000Z',
        },
      },
    ]);

    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    expect(result.current.orders[0].payment).toMatchObject({ id: PAYMENT_ID, state: 'awaiting_entitlement' });
    expect(CommerceController.getMarketplacePayment).not.toHaveBeenCalled();
    // receiptId is null until payment confirmation issues the receipt.
    expect(CommerceController.getMarketplaceReceipt).not.toHaveBeenCalled();

    vi.mocked(CommerceController.getMarketplaceOrders).mockClear();
    await act(() => result.current.refresh());
    expect(CommerceController.getMarketplaceOrders).toHaveBeenCalledTimes(1);
    expect(CommerceController.getMarketplacePayment).not.toHaveBeenCalled();
  });

  it('sources expected_revision from the loaded order and refetches on a revision conflict', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'The aggregate changed.', currentRevision: 3 },
    });
    vi.mocked(CommerceController.getMarketplaceOrders).mockClear();

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'fulfillment.confirm_delivery', {});
    });

    expect(succeeded).toBe(false);
    expect(CommerceController.executeMarketplaceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: `order:${order.id}`,
        expectedRevision: order.revision,
        kind: 'fulfillment.confirm_delivery',
      }),
    );
    // The conflict refetched the timeline so the retry starts from truth.
    expect(CommerceController.getMarketplaceOrders).toHaveBeenCalled();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('reloaded') }),
    );
  });

  it.each<[string, Partial<MarketplaceOrder>, string]>([
    ['a PayPal full refund', { state: 'refunded_external' }, MARKETPLACE_FAILURE_MESSAGES.orderRefundedMeanwhile],
    [
      'a PayPal reversal',
      { state: 'refunded_external', paymentReversedAt: '2026-09-24T18:00:00.000Z' },
      MARKETPLACE_FAILURE_MESSAGES.orderReversedMeanwhile,
    ],
    ['a PayPal partial refund', {}, MARKETPLACE_FAILURE_MESSAGES.orderRefundRecordedMeanwhile],
  ])('names %s that landed during a conflicting action', async (_name, change, message) => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'The aggregate changed.', currentRevision: 2 },
    });
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([
      {
        ...order,
        revision: 2,
        externalRefund: {
          amountMinor: 100,
          transactionId: '9RF12345AB678901C',
          recordedAt: '2026-09-24T18:00:00.000Z',
        },
        ...change,
      },
    ]);
    const { toast } = await import('@/molecules/Toaster/use-toast');
    vi.mocked(toast).mockClear();

    await act(async () => {
      await result.current.actOnOrder(order, 'fulfillment.confirm_delivery', {});
    });

    expect(vi.mocked(toast)).toHaveBeenCalledWith({ variant: 'error', description: message });
  });

  it('treats a revision conflict as success when the re-read already shows the action', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'The aggregate changed.', currentRevision: 4 },
    });
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([
      {
        ...order,
        revision: 4,
        state: 'return_requested',
        returnRequest: {
          state: 'requested',
          reason: 'mistake on my part',
          requestedAmountMinor: 250,
          requestedAt: '2026-09-23T12:00:00.000Z',
          updatedAt: '2026-09-23T12:00:00.000Z',
        },
      },
    ]);
    const { toast } = await import('@/molecules/Toaster/use-toast');
    vi.mocked(toast).mockClear();

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'return.request', {
        reason: 'mistake on my part',
        requestedAmountMinor: 250,
      });
    });

    expect(succeeded).toBe(true);
    expect(result.current.orders[0].order.state).toBe('return_requested');
    expect(result.current.orders[0].order.returnRequest).toMatchObject({
      reason: 'mistake on my part',
      requestedAmountMinor: 250,
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('reloaded');
  });

  describe('per-item review commands', () => {
    const items = [
      { listingId: 'boots', rating: 5, text: 'Great boots.' },
      { listingId: 'belt', rating: 3, text: '' },
    ];
    const reviewWire = (listingId: string, rating: number, text: string) => ({
      id: `00000000-0000-4000-8000-00000000${listingId === 'boots' ? '2001' : '2002'}`,
      reviewerPubky: BUYER,
      subjectPubky: SELLER,
      listingAggregateId: `listing:${SELLER}_${listingId}`,
      rating,
      text,
      createdAt: '2026-08-21T10:00:00.000Z',
    });

    it('publishes the records of the command result once the command is accepted', async () => {
      const { result } = renderHook(() => useMarketplaceOrders());
      await waitFor(() => expect(result.current.orders).toHaveLength(1));
      const order = result.current.orders[0].order;
      const commandResult = { kind: 'review' as const, reviews: [], attestations: [] };
      vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
        ok: true,
        version: 1,
        commandId: '00000000-0000-4000-8000-000000001111',
        aggregateId: `order:${order.id}`,
        revision: 2,
        eventIds: [],
        result: commandResult,
      });
      vi.mocked(CommerceController.publishOwnMarketplaceReviews).mockResolvedValueOnce([{} as never, {} as never]);

      let succeeded = false;
      await act(async () => {
        succeeded = await result.current.actOnOrder(order, 'review.create', { items });
      });

      expect(succeeded).toBe(true);
      expect(CommerceController.publishOwnMarketplaceReviews).toHaveBeenCalledWith(order, commandResult);
      expect(vi.mocked(toast)).toHaveBeenCalledWith({
        description: '2 reviews published to your homeserver with their purchase attestations.',
      });
    });

    it.each(['INVARIANT_VIOLATION', 'INVALID_STATE'])(
      'lets the second tab of a double submit finish without publishing a second record set on %s',
      async (code) => {
        const { result } = renderHook(() => useMarketplaceOrders());
        await waitFor(() => expect(result.current.orders).toHaveLength(1));
        const order = result.current.orders[0].order;
        vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
          ok: false,
          error: { code, message: 'This participant already reviewed these listings.' },
        });
        vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([
          {
            ...order,
            revision: 3,
            state: 'completed',
            reviews: items.map(({ listingId, rating, text }) => reviewWire(listingId, rating, text)),
          },
        ]);
        vi.mocked(toast).mockClear();

        let succeeded = false;
        await act(async () => {
          succeeded = await result.current.actOnOrder(order, 'review.create', { items });
        });

        expect(succeeded).toBe(true);
        expect(CommerceController.publishOwnMarketplaceReviews).not.toHaveBeenCalled();
        expect(vi.mocked(toast)).not.toHaveBeenCalled();
      },
    );

    it('still reports a refused review whose listings the order does not show as reviewed', async () => {
      const { result } = renderHook(() => useMarketplaceOrders());
      await waitFor(() => expect(result.current.orders).toHaveLength(1));
      const order = result.current.orders[0].order;
      vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
        ok: false,
        error: { code: 'INVALID_STATE', message: 'The order is not eligible for review.' },
      });
      vi.mocked(toast).mockClear();

      let succeeded = true;
      await act(async () => {
        succeeded = await result.current.actOnOrder(order, 'review.create', { items });
      });

      expect(succeeded).toBe(false);
      expect(CommerceController.publishOwnMarketplaceReviews).not.toHaveBeenCalled();
      expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
    });
  });

  it('toasts static pickup-refusal copy from actOnOrder and never an echoed meeting address', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    const echoed = 'Meet at 14 Oak Lane after 6pm; ask for the red jacket.';
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_STATE', message: echoed },
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'fulfillment.confirm_pickup', {});
    });

    expect(succeeded).toBe(false);
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: 'The pickup request was refused.',
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('14 Oak Lane');
  });

  it.each(['fulfillment.ship', 'fulfillment.mark_ready', 'fulfillment.confirm_pickup'])(
    'shows the payment_not_final copy, never the server message, when %s is refused on a USDT order',
    async (kind) => {
      const { result } = renderHook(() => useMarketplaceOrders());
      await waitFor(() => expect(result.current.orders).toHaveLength(1));
      const order = result.current.orders[0].order;
      const { toast } = await import('@/molecules/Toaster/use-toast');
      vi.mocked(toast).mockClear();

      vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce(
        USDT_WIRE_PAYMENT_NOT_FINAL_REFUSAL,
      );
      let succeeded = true;
      await act(async () => {
        succeeded = await result.current.actOnOrder(order, kind, {});
      });

      expect(succeeded).toBe(false);
      expect(vi.mocked(toast)).toHaveBeenCalledWith({ variant: 'error', description: PAYMENT_NOT_FINAL_COPY });
      expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('The payment is not final.');
    },
  );

  it('shows a plain refund refusal and keeps markup off the toast', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    const { toast } = await import('@/molecules/Toaster/use-toast');

    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: 'The external refund cannot be recorded.' },
    });
    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'refund.record_external', {
        amountMinor: 189,
        transactionId: 'PAYPALREF1',
      });
    });

    expect(succeeded).toBe(false);
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: 'The external refund cannot be recorded.',
    });

    vi.mocked(toast).mockClear();
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: '<b>The external refund cannot be recorded.</b>' },
    });
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'refund.record_external', {
        amountMinor: 189,
        transactionId: 'PAYPALREF1',
      });
    });

    expect(succeeded).toBe(false);
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: 'Could not update this order.',
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('<b>');

    vi.mocked(toast).mockClear();
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: 'The external refund cannot be recorded.' },
    });
    await act(async () => {
      await result.current.actOnOrder(order, 'fulfillment.confirm_delivery', {});
    });
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: 'Could not update this order.',
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('The external refund cannot be recorded.');
  });

  it.each([
    [
      'refund.record_external',
      'invalid_refund_reference',
      'Enter the Arbitrum transaction hash (0x followed by 64 characters).',
    ],
    [
      'refund.record_external',
      'refund_destination_required',
      "Ask the buyer to confirm a refund address first. It's on their order page.",
    ],
    [
      'refund.record_external',
      'refund_rail_unknown',
      'The buyer paid on both rails and the Shop cannot tell which one this refund returns. Resolve the order as paid or abandoned first.',
    ],
    [
      'refund.record_external',
      'refund_amount_unrecordable',
      'This USDT amount cannot be recorded as a refund because it is not a whole number of cents. Contact the marketplace operator.',
    ],
    [
      'refund.confirm_destination',
      'invalid_refund_destination',
      "That isn't a valid Arbitrum address. Check it and try again.",
    ],
  ] as const)('maps the USDT refusal reason on %s (%s) to its static copy', async (kind, reason, copy) => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    const { toast } = await import('@/molecules/Toaster/use-toast');
    vi.mocked(toast).mockClear();
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_COMMAND', message: 'rejected 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', reason },
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, kind, { address: '0x1' });
    });

    expect(succeeded).toBe(false);
    expect(vi.mocked(toast)).toHaveBeenCalledWith({ variant: 'error', description: copy });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('5aAeb');
  });

  it.each(['refund_rail_unknown', 'refund_amount_unrecordable'])(
    'never shows the seller-directed %s copy or the raw token on the buyer refund-address path',
    async (reason) => {
      const { result } = renderHook(() => useMarketplaceOrders());
      await waitFor(() => expect(result.current.orders).toHaveLength(1));
      const order = result.current.orders[0].order;
      const { toast } = await import('@/molecules/Toaster/use-toast');
      vi.mocked(toast).mockClear();
      vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValueOnce({
        ok: false,
        error: { code: 'INVALID_STATE', message: reason, reason },
      });

      await act(async () => {
        await result.current.actOnOrder(order, 'refund.confirm_destination', { address: '0x1' });
      });

      const shown = JSON.stringify(vi.mocked(toast).mock.calls);
      expect(shown).not.toContain(reason);
      expect(shown).not.toContain('Resolve the order as paid or abandoned');
      expect(shown).not.toContain('Contact the marketplace operator');
    },
  );

  it('flags needsSession on a session-required load failure and refetches once a session connects', async () => {
    config.mode = 'transaction-service';
    vi.mocked(CommerceController.getMarketplaceOrders).mockRejectedValue(sessionRequiredError());

    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.needsSession).toBe(true));
    expect(result.current.error).toBe(MARKETPLACE_FAILURE_MESSAGES.session);
    expect(result.current.orders).toHaveLength(0);

    // Approving on the signer mirrors the session into the store, which must
    // trigger an automatic refetch — no manual reload.
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([]);
    act(() => {
      useCommerceStore.getState().setMarketplaceSession({
        pubky: BUYER,
        capabilities: '/pub/pubky.app/:rw',
        expiresAt: '2026-08-22T00:00:00.000Z',
        issuedAt: '2026-08-21T00:00:00.000Z',
      });
    });

    await waitFor(() => expect(result.current.needsSession).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('keeps needsSession false for non-session failures', async () => {
    config.mode = 'transaction-service';
    vi.mocked(CommerceController.getMarketplaceOrders).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.needsSession).toBe(false);
  });

  it('flags needsSession when an order action is rejected for an expired session', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const order = result.current.orders[0].order;
    vi.mocked(CommerceController.executeMarketplaceCommand).mockRejectedValue(sessionRequiredError());

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.actOnOrder(order, 'fulfillment.confirm_delivery', {});
    });

    expect(succeeded).toBe(false);
    expect(result.current.needsSession).toBe(true);
    expect(result.current.error).toBe(MARKETPLACE_FAILURE_MESSAGES.session);
  });

  it('refuses to advance a payment outside sandbox mode', async () => {
    const { result } = renderHook(() => useMarketplaceOrders());
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    const payment = result.current.orders[0].payment!;

    config.mode = 'transaction-service';
    let advanced: boolean | undefined;
    await act(async () => {
      advanced = await result.current.advancePayment(payment, 'confirmed', 1);
    });

    expect(advanced).toBe(false);
    expect(CommerceController.executeMarketplaceCommand).not.toHaveBeenCalled();
  });
});
