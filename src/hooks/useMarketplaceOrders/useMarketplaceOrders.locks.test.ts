import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceDigitalLock } from '@/libs/commerce/marketplace-records';
import type { MarketplaceOrder, MarketplacePayment } from '@/services/marketplace/marketplace';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import {
  createOrderFixture,
  createPaymentFixture,
  ORDER_FIXTURE_BUYER,
  ORDER_FIXTURE_SELLER,
} from '@/test/fixtures/commerce/orders';
import { useMarketplaceLocksPayment } from '../useMarketplaceLocksPayment/useMarketplaceLocksPayment';
import { type MarketplaceOrderView, useMarketplaceOrders } from './useMarketplaceOrders';

const POLL_MS = 2_000;
const WINDOW_MS = 60 * 60_000;

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'locks-paykit',
    getCommercePollIntervalMs: () => POLL_MS,
  };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: ORDER_FIXTURE_BUYER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMarketplaceOrders: vi.fn(),
    getMarketplacePayment: vi.fn(),
    getMarketplaceReceipt: vi.fn(async () => null),
    resumeOwnReviewPublications: vi.fn(async () => 0),
    resumeOwnReviewRemovals: vi.fn(async () => 0),
    sweepOwnAuctionReserves: vi.fn(async () => 0),
    resumeOwnReviewResponsePublications: vi.fn(async () => 0),
    publishOrderReceipts: vi.fn(async () => undefined),
    getMarketplaceLocksCorrelation: vi.fn(),
    fetchMarketplaceLocksAdmission: vi.fn(async () => null),
  },
}));

vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn() },
}));

const digitalLock: CommerceDigitalLock = {
  policyUri: `pubky://${ORDER_FIXTURE_SELLER}/pub/locks.app/${'0'.repeat(52)}.json`,
  criterionId: 'criterion-1',
  contentPath: 'premium.txt',
  resourceHash: 'a'.repeat(64),
  minimumConfirmations: 1,
};

function locksOrder(index: number, state: MarketplacePayment['state']): MarketplaceOrder {
  const id = `018f47d2-6a27-7c23-a49d-00000000070${index}`;
  const paymentId = `018f47d2-6a27-7c23-a49d-00000000080${index}`;
  return createOrderFixture(state === 'confirmed' ? 'paid' : 'pending_payment', {
    id,
    paymentId,
    fulfillment: 'digital',
    payment: createPaymentFixture(state, { id: paymentId, orderId: id, adapter: 'locks' }),
  });
}

function correlationFor(paymentId: string, windowExpiresAt: number) {
  return {
    id: `b:${paymentId}`,
    owner_id: ORDER_FIXTURE_BUYER,
    payment_id: paymentId,
    order_id: paymentId,
    seller_pubky: ORDER_FIXTURE_SELLER,
    bundle_id: '000G40R40M30E209185GR38E1W',
    policy_uri: digitalLock.policyUri,
    criterion_id: digitalLock.criterionId,
    content_path: digitalLock.contentPath,
    resource_hash: digitalLock.resourceHash,
    window_expires_at: new Date(windowExpiresAt).toISOString(),
    registered: true,
    created_at: 1,
    updated_at: 1,
  };
}

// One status card per pending order, wired the way Checkout and Orders wire it.
function useLocksCard(
  view: MarketplaceOrderView | undefined,
  fallback: MarketplaceOrder,
  refresh: () => Promise<void>,
) {
  return useMarketplaceLocksPayment({
    order: view?.order ?? fallback,
    payment: view?.payment ?? null,
    digitalLock,
    isBuyer: true,
    onPaymentChanged: refresh,
  });
}

describe('useMarketplaceOrders with pending Locks payments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useCommerceStore.getState().reset();
  });

  afterEach(() => vi.useRealTimers());

  it('reloads the projections once per interval and surfaces a confirmation that lands after the window', async () => {
    const windowExpiresAt = Date.now() + WINDOW_MS;
    const pendingA = locksOrder(1, 'awaiting_entitlement');
    const pendingB = locksOrder(2, 'awaiting_entitlement');
    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([pendingA, pendingB]);
    vi.mocked(CommerceController.getMarketplaceLocksCorrelation).mockImplementation(async (paymentId) =>
      correlationFor(String(paymentId), windowExpiresAt),
    );

    const { result } = renderHook(() => {
      const orders = useMarketplaceOrders();
      const cardA = useLocksCard(orders.orders[0], pendingA, orders.refresh);
      const cardB = useLocksCard(orders.orders[1], pendingB, orders.refresh);
      return { orders, cardA, cardB };
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.current.cardA.correlation?.registered).toBe(true);
    expect(result.current.cardB.correlation?.registered).toBe(true);
    const reads = () => vi.mocked(CommerceController.getMarketplaceOrders).mock.calls.length;
    expect(reads()).toBe(1);

    // Two pending cards add no reads of their own inside the window.
    await act(async () => vi.advanceTimersByTimeAsync(5 * POLL_MS));
    expect(reads()).toBe(6);

    // 25 hours past the one-hour window the service still holds the order for a live task.
    vi.setSystemTime(windowExpiresAt + 25 * 3_600_000);
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(reads()).toBe(7);
    expect(result.current.orders.orders[0].payment?.state).toBe('awaiting_entitlement');

    vi.mocked(CommerceController.getMarketplaceOrders).mockResolvedValue([locksOrder(1, 'confirmed'), pendingB]);
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(reads()).toBe(8);
    expect(result.current.orders.orders[0].payment?.state).toBe('confirmed');
    expect(result.current.orders.orders[0].order.state).toBe('paid');
    expect(result.current.orders.orders[1].payment?.state).toBe('awaiting_entitlement');
  });
});
