import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { CommerceAdapterMode } from '@/config/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { setStoreSeller } from '@/test-utils/store-mode';
import { CommerceController } from './commerce';

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const STORE_SELLER = COMMERCE_FIXTURE_SELLER;
const VIEWER = COMMERCE_FIXTURE_BUYER;
const OTHER_BUYER = 'o'.repeat(52);

const purchase = { id: 'order-purchase', sellerPubky: STORE_SELLER, buyerPubky: VIEWER, lines: [] };
const sale = { id: 'order-sale', sellerPubky: VIEWER, buyerPubky: OTHER_BUYER, lines: [] };
const unread = { recipientPubky: VIEWER, readAt: null };
const notifications = [
  createNotificationFixture('payment_confirmed', {
    ...unread,
    id: '018f47d2-6a27-7c23-a62f-000000000001',
    aggregateId: 'order:order-purchase',
  }),
  createNotificationFixture('order_created', {
    ...unread,
    id: '018f47d2-6a27-7c23-a62f-000000000002',
    aggregateId: 'order:order-sale',
  }),
  createNotificationFixture('offer_received', {
    ...unread,
    id: '018f47d2-6a27-7c23-a62f-000000000003',
    aggregateId: 'offer:offer-received',
  }),
];
const notificationIds = (rows: { id: string }[]) => rows.map(({ id }) => id.slice(-1));

describe('CommerceController seller side in a store', () => {
  beforeEach(() => {
    commerceConfig.mode = 'transaction-service';
    useAuthStore.setState({ currentUserPubky: VIEWER });
    vi.spyOn(CommerceApplication, 'getMarketplaceNotifications').mockResolvedValue(notifications);
    vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([purchase, sale] as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceOrder').mockImplementation(
      async (_actor, orderId) => ([purchase, sale].find(({ id }) => id === orderId) ?? null) as never,
    );
    vi.spyOn(CommerceApplication, 'getMarketplaceOffers').mockResolvedValue([
      { id: 'offer-made', sellerPubky: STORE_SELLER, buyerPubky: VIEWER },
      { id: 'offer-received', sellerPubky: VIEWER, buyerPubky: OTHER_BUYER },
    ] as never);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  const ids = (rows: { id: string }[]) => rows.map(({ id }) => id);

  it('gives another signed-in seller only their buyer side', async () => {
    setStoreSeller(STORE_SELLER);

    expect(ids(await CommerceController.getMarketplaceOrders())).toEqual(['order-purchase']);
    expect(ids(await CommerceController.getMarketplaceOffers())).toEqual(['offer-made']);
    expect(await CommerceController.getMarketplaceOrder('order-sale')).toBeNull();
    expect((await CommerceController.getMarketplaceOrder('order-purchase'))?.id).toBe('order-purchase');
  });

  it('gives another signed-in seller only their buyer-side notifications, on every notification read', async () => {
    setStoreSeller(STORE_SELLER);

    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['1']);
    expect(notificationIds(await CommerceController.getMarketplaceFeedNotifications())).toEqual(['1']);

    commerceConfig.mode = 'sandbox';
    await CommerceController.refreshMarketplaceNotificationBadge();
    expect(useNotificationStore.getState().marketplaceUnread).toBe(1);

    const markRead = vi.spyOn(CommerceController, 'executeMarketplaceCommand').mockResolvedValue({ ok: true } as never);
    await CommerceController.markAllMarketplaceNotificationsRead();
    expect(markRead.mock.calls).toEqual([
      [expect.objectContaining({ payload: { notificationId: notifications[0].id } })],
    ]);
  });

  it('keeps every notification for the store seller and outside store mode', async () => {
    commerceConfig.mode = 'sandbox';
    for (const storeSeller of [VIEWER, undefined]) {
      setStoreSeller(storeSeller);
      expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['1', '2', '3']);
      await CommerceController.refreshMarketplaceNotificationBadge();
      expect(useNotificationStore.getState().marketplaceUnread).toBe(3);
    }
    expect(CommerceApplication.getMarketplaceOrders).not.toHaveBeenCalled();
  });

  it('keeps the seller side for the store seller', async () => {
    setStoreSeller(VIEWER);

    expect(ids(await CommerceController.getMarketplaceOrders())).toEqual(['order-purchase', 'order-sale']);
    expect(ids(await CommerceController.getMarketplaceOffers())).toEqual(['offer-made', 'offer-received']);
    expect((await CommerceController.getMarketplaceOrder('order-sale'))?.id).toBe('order-sale');
  });

  it('keeps the seller side outside store mode', async () => {
    expect(ids(await CommerceController.getMarketplaceOrders())).toEqual(['order-purchase', 'order-sale']);
    expect(ids(await CommerceController.getMarketplaceOffers())).toEqual(['offer-made', 'offer-received']);
    expect((await CommerceController.getMarketplaceOrder('order-sale'))?.id).toBe('order-sale');
  });
});
