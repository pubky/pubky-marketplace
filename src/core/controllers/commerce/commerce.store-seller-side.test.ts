import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { CommerceAdapterMode } from '@/config/commerce';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { MarketplaceTransactionService } from '@/services/marketplace/marketplace-transaction';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { createModerationDecisionFixture, createNotificationFixture } from '@/test/fixtures/commerce/notifications';
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
    vi.spyOn(MarketplaceGatewayService, 'getOrders').mockResolvedValue([purchase, sale] as never);
    vi.spyOn(MarketplaceTransactionService, 'getOrder').mockImplementation(
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

  it('reads only the lists the notifications need, and survives one that fails', async () => {
    setStoreSeller(STORE_SELLER);
    const outbid = createNotificationFixture('outbid', {
      ...unread,
      id: '018f47d2-6a27-7c23-a62f-000000000004',
      aggregateId: `listing:${STORE_SELLER}_boots`,
    });
    vi.mocked(CommerceApplication.getMarketplaceNotifications).mockResolvedValue([outbid]);
    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['4']);
    expect(CommerceApplication.getMarketplaceOrders).not.toHaveBeenCalled();
    expect(CommerceApplication.getMarketplaceOffers).not.toHaveBeenCalled();

    vi.mocked(CommerceApplication.getMarketplaceNotifications).mockResolvedValue([...notifications, outbid]);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockRejectedValue(new Error('orders are down'));
    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['4']);
    expect(CommerceApplication.getMarketplaceOrder).not.toHaveBeenCalled();
  });

  it('reads an order the list does not name by id in durable modes, keeping it when the viewer bought it', async () => {
    setStoreSeller(STORE_SELLER);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([] as never);

    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['1']);
    expect(vi.mocked(CommerceApplication.getMarketplaceOrder).mock.calls.map(([, id]) => id)).toEqual([
      'order-purchase',
      'order-sale',
    ]);

    vi.mocked(CommerceApplication.getMarketplaceOrder).mockClear();
    commerceConfig.mode = 'sandbox';
    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual([]);
    expect(CommerceApplication.getMarketplaceOrder).not.toHaveBeenCalled();
  });

  it('keeps moderation of a review the viewer wrote as a buyer, and nothing about its selling', async () => {
    setStoreSeller(STORE_SELLER);
    const review = (reviewId: string, role: string) => ({ owner_id: VIEWER, review_id: reviewId, record: { role } });
    const asBuyer = '018f47d2-6a27-7c23-a62f-0000000000b1';
    const asSeller = '018f47d2-6a27-7c23-a62f-0000000000b2';
    vi.spyOn(CommerceApplication, 'getOwnReviews').mockResolvedValue([
      review(asBuyer, 'buyer_reviewing_seller'),
      review(asSeller, 'seller_reviewing_buyer'),
    ] as never);
    const decision = (
      id: string,
      restriction: 'review_text_hidden' | 'review_excluded' | 'listing_removed',
      reviewId: string,
    ) =>
      createNotificationFixture('moderation_decision', {
        ...unread,
        id: `018f47d2-6a27-7c23-a62f-00000000000${id}`,
        moderationDecision: createModerationDecisionFixture({
          restriction,
          targetUri: CommerceRecordNormalizer.reviewUri(VIEWER, reviewId),
        }),
      });
    vi.mocked(CommerceApplication.getMarketplaceNotifications).mockResolvedValue([
      decision('5', 'review_text_hidden', asBuyer),
      decision('6', 'review_excluded', asSeller),
      decision('7', 'listing_removed', asBuyer),
    ]);

    expect(notificationIds(await CommerceController.getMarketplaceNotifications())).toEqual(['5']);
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

  const OFFER_BOUGHT = '00000000-0000-4000-8000-000000000901';
  const OFFER_SOLD = '00000000-0000-4000-8000-000000000902';
  const OFFER_UNKNOWN = '00000000-0000-4000-8000-000000000903';
  const offerCommand = (kind: string, offerId: string) => ({
    version: 1,
    commandId: '00000000-0000-4000-8000-000000000910',
    expectedRevision: 1,
    issuedAt: '2026-08-19T23:00:00.000Z',
    aggregateId: `offer:${offerId}`,
    kind,
    payload: { offerId },
  });
  const refused = { code: 'FORBIDDEN', operation: 'assertCanSellHere' };

  it('runs commands on what another seller buys in a store, and refuses those on what it sells', async () => {
    vi.mocked(CommerceApplication.getMarketplaceOffers).mockResolvedValue([
      { id: OFFER_BOUGHT, sellerPubky: STORE_SELLER, buyerPubky: VIEWER },
      { id: OFFER_SOLD, sellerPubky: VIEWER, buyerPubky: OTHER_BUYER },
    ] as never);
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue({ ok: true } as never);
    setStoreSeller(STORE_SELLER);

    await expect(
      CommerceController.executeMarketplaceCommand(offerCommand('offer.withdraw', OFFER_BOUGHT)),
    ).resolves.toEqual({ ok: true });
    for (const offerId of [OFFER_SOLD, OFFER_UNKNOWN]) {
      await expect(
        CommerceController.executeMarketplaceCommand(offerCommand('offer.accept', offerId)),
      ).rejects.toMatchObject(refused);
    }
    expect(execute).toHaveBeenCalledTimes(1);

    setStoreSeller(undefined);
    await expect(
      CommerceController.executeMarketplaceCommand(offerCommand('offer.accept', OFFER_SOLD)),
    ).resolves.toEqual({ ok: true });
  });

  it.each(['sandbox', 'transaction-service'])(
    'runs order commands on a purchase and refuses those on a sale in a %s store',
    async (mode) => {
      commerceConfig.mode = mode;
      const execute = vi
        .spyOn(CommerceApplication, 'executeMarketplaceCommand')
        .mockResolvedValue({ ok: true } as never);
      const orderCommand = (orderId: string) => ({
        ...offerCommand('fulfillment.confirm_delivery', orderId),
        aggregateId: `order:${orderId}`,
        payload: { orderId: '00000000-0000-4000-8000-000000000920' },
      });
      setStoreSeller(STORE_SELLER);

      await expect(CommerceController.executeMarketplaceCommand(orderCommand('order-purchase'))).resolves.toEqual({
        ok: true,
      });
      for (const orderId of ['order-sale', 'order-unknown']) {
        await expect(CommerceController.executeMarketplaceCommand(orderCommand(orderId))).rejects.toMatchObject(
          refused,
        );
      }
      expect(execute).toHaveBeenCalledTimes(1);
      expect(MarketplaceTransactionService.getOrder).toHaveBeenCalledTimes(mode === 'sandbox' ? 0 : 3);
    },
  );

  it('confirms the pickup and reads the delivery email of a purchase, not of a sale', async () => {
    const confirm = vi.spyOn(CommerceApplication, 'commitConfirmPickup').mockResolvedValue({ ok: true } as never);
    const email = vi.spyOn(CommerceApplication, 'fetchOrderDeliveryEmail').mockResolvedValue(null as never);
    setStoreSeller(STORE_SELLER);

    await CommerceController.commitConfirmPickup('order-purchase', 1);
    await CommerceController.fetchOrderDeliveryEmail('order-purchase');
    await expect(CommerceController.commitConfirmPickup('order-sale', 1)).rejects.toMatchObject(refused);
    await expect(CommerceController.fetchOrderDeliveryEmail('order-sale')).rejects.toMatchObject(refused);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('hides the payment and receipt of a sale from another seller in a store', async () => {
    vi.spyOn(CommerceApplication, 'getMarketplacePayment').mockImplementation(
      async (_actor, id) => ({ id, sellerPubky: id === 'payment-sale' ? VIEWER : STORE_SELLER }) as never,
    );
    vi.spyOn(CommerceApplication, 'getMarketplaceReceipt').mockImplementation(
      async (_actor, id) => ({ id, issuerPubky: id === 'receipt-sale' ? VIEWER : STORE_SELLER }) as never,
    );
    setStoreSeller(STORE_SELLER);

    expect(await CommerceController.getMarketplacePayment('payment-sale')).toBeNull();
    expect(await CommerceController.getMarketplacePayment('payment-purchase')).toMatchObject({
      id: 'payment-purchase',
    });
    expect(await CommerceController.getMarketplaceReceipt('receipt-sale')).toBeNull();
    expect(await CommerceController.getMarketplaceReceipt('receipt-purchase')).toMatchObject({
      id: 'receipt-purchase',
    });

    setStoreSeller(undefined);
    expect(await CommerceController.getMarketplacePayment('payment-sale')).toMatchObject({ id: 'payment-sale' });
    expect(await CommerceController.getMarketplaceReceipt('receipt-sale')).toMatchObject({ id: 'receipt-sale' });
  });

  it('keeps only the reviews another seller wrote as a buyer, and lets it withdraw only those', async () => {
    const review = (orderId: string, role: string) => ({ order_id: orderId, record: { role } });
    vi.spyOn(CommerceApplication, 'getOwnReviews').mockResolvedValue([
      review('order-purchase', 'buyer_reviewing_seller'),
      review('order-sale', 'seller_reviewing_buyer'),
    ] as never);
    vi.spyOn(CommerceApplication, 'getAwaitingReleaseReviews').mockResolvedValue([
      { orderId: 'order-held-sale', reviewerRole: 'seller', releaseAt: null, items: [] },
      { orderId: 'order-held-purchase', reviewerRole: 'buyer', releaseAt: null, items: [] },
    ]);
    const remove = vi.spyOn(CommerceApplication, 'commitDeleteOwnReview').mockResolvedValue('removed');
    setStoreSeller(STORE_SELLER);

    expect((await CommerceController.getOwnMarketplaceReviews()).map(({ order_id }) => order_id)).toEqual([
      'order-purchase',
    ]);
    expect((await CommerceController.getAwaitingReleaseOwnMarketplaceReviews()).map(({ orderId }) => orderId)).toEqual([
      'order-held-purchase',
    ]);
    await CommerceController.commitDeleteOwnMarketplaceReview('order-purchase');
    await CommerceController.commitDeleteOwnMarketplaceReview('order-held-purchase');
    for (const orderId of ['order-sale', 'order-held-sale']) {
      await expect(CommerceController.commitDeleteOwnMarketplaceReview(orderId)).rejects.toMatchObject(refused);
    }
    expect(remove.mock.calls.map(([, orderId]) => orderId)).toEqual(['order-purchase', 'order-held-purchase']);

    setStoreSeller(undefined);
    expect(await CommerceController.getOwnMarketplaceReviews()).toHaveLength(2);
  });

  it('runs only the buyer side of the orders loader for another seller in a store', async () => {
    const publications = vi.spyOn(CommerceApplication, 'resumeOwnReviewPublications').mockResolvedValue(0);
    const removals = vi.spyOn(CommerceApplication, 'resumeOwnReviewRemovals').mockResolvedValue(0);
    const receipts = vi.spyOn(CommerceApplication, 'publishOrderReceipts').mockResolvedValue('published');
    const reserves = vi.spyOn(CommerceApplication, 'sweepOwnAuctionReserves').mockResolvedValue(2);
    const responses = vi.spyOn(CommerceApplication, 'resumeOwnReviewResponsePublications').mockResolvedValue(1);
    const run = async () => {
      await CommerceController.resumeOwnReviewPublications();
      await CommerceController.resumeOwnReviewRemovals();
      await CommerceController.publishOrderReceipts([]);
      return [
        await CommerceController.sweepOwnAuctionReserves(),
        await CommerceController.resumeOwnReviewResponsePublications(),
      ];
    };

    setStoreSeller(STORE_SELLER);
    expect(await run()).toEqual([0, 0]);
    expect(publications).toHaveBeenLastCalledWith(VIEWER, { sellerSide: false });
    expect(removals).toHaveBeenLastCalledWith(VIEWER, { sellerSide: false });
    expect(receipts).toHaveBeenLastCalledWith(VIEWER, [], { sellerSide: false });
    expect(reserves).not.toHaveBeenCalled();
    expect(responses).not.toHaveBeenCalled();

    for (const storeSeller of [VIEWER, undefined]) {
      setStoreSeller(storeSeller);
      expect(await run()).toEqual([2, 1]);
      expect(publications).toHaveBeenLastCalledWith(VIEWER, { sellerSide: true });
      expect(removals).toHaveBeenLastCalledWith(VIEWER, { sellerSide: true });
      expect(receipts).toHaveBeenLastCalledWith(VIEWER, [], { sellerSide: true });
    }
  });
});
