import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { setStoreSeller } from '@/test-utils/store-mode';
import { CommerceController } from './commerce';

const BUYER = COMMERCE_FIXTURE_BUYER;
const STORE_SELLER = COMMERCE_FIXTURE_SELLER;
const OTHER_SELLER = 'o'.repeat(52);

const listingRow = (id: string, seller: string) => ({ id, owner_id: BUYER, listing_id: `${seller}:${id}` });

describe('CommerceController lists in a store', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: BUYER });
    vi.spyOn(CommerceApplication, 'getCartItems').mockResolvedValue([
      listingRow('cart-store', STORE_SELLER),
      listingRow('cart-other', OTHER_SELLER),
    ] as never);
    vi.spyOn(CommerceApplication, 'getFavorites').mockResolvedValue([
      listingRow('fav-store', STORE_SELLER),
      listingRow('fav-other', OTHER_SELLER),
    ] as never);
    vi.spyOn(CommerceApplication, 'getWatchAlerts').mockResolvedValue([
      listingRow('alert-store', STORE_SELLER),
      listingRow('alert-other', OTHER_SELLER),
    ] as never);
    vi.spyOn(CommerceApplication, 'getWatchSnapshots').mockResolvedValue([
      listingRow('snap-store', STORE_SELLER),
      listingRow('snap-other', OTHER_SELLER),
    ] as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([
      { id: 'order-store', sellerPubky: STORE_SELLER, buyerPubky: BUYER, lines: [] },
      { id: 'order-other', sellerPubky: OTHER_SELLER, buyerPubky: BUYER, lines: [] },
    ] as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceOffers').mockResolvedValue([
      { id: 'offer-store', sellerPubky: STORE_SELLER },
      { id: 'offer-other', sellerPubky: OTHER_SELLER },
    ] as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceNotifications').mockResolvedValue([
      { id: 'n-order-store', aggregateId: 'order:order-store', actorPubky: STORE_SELLER, recipientPubky: BUYER },
      { id: 'n-order-other', aggregateId: 'order:order-other', actorPubky: OTHER_SELLER, recipientPubky: BUYER },
      { id: 'n-offer-other', aggregateId: 'offer:offer-other', actorPubky: OTHER_SELLER, recipientPubky: BUYER },
    ] as never);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  const ids = (rows: { id: string }[]) => rows.map(({ id }) => id);

  it('shows only the store seller as counterparty', async () => {
    setStoreSeller(STORE_SELLER);

    expect(ids(await CommerceController.getCartItems())).toEqual(['cart-store']);
    expect(ids(await CommerceController.getFavorites())).toEqual(['fav-store']);
    expect(ids(await CommerceController.getWatchAlerts())).toEqual(['alert-store']);
    expect(ids(await CommerceController.getWatchSnapshots())).toEqual(['snap-store']);
    expect(ids(await CommerceController.getMarketplaceOrders())).toEqual(['order-store']);
    expect(ids(await CommerceController.getMarketplaceOffers())).toEqual(['offer-store']);
    expect(ids(await CommerceController.getMarketplaceNotifications())).toEqual(['n-order-store']);
  });

  it('shows every seller outside store mode, without fetching orders for notifications', async () => {
    expect(ids(await CommerceController.getCartItems())).toEqual(['cart-store', 'cart-other']);
    expect(ids(await CommerceController.getFavorites())).toEqual(['fav-store', 'fav-other']);
    expect(ids(await CommerceController.getMarketplaceOffers())).toEqual(['offer-store', 'offer-other']);
    expect(await CommerceController.getMarketplaceNotifications()).toHaveLength(3);
    expect(CommerceApplication.getMarketplaceOrders).not.toHaveBeenCalled();
  });
});
