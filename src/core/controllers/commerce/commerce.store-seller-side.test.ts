import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { setStoreSeller } from '@/test-utils/store-mode';
import { CommerceController } from './commerce';

const STORE_SELLER = COMMERCE_FIXTURE_SELLER;
const VIEWER = COMMERCE_FIXTURE_BUYER;
const OTHER_BUYER = 'o'.repeat(52);

const purchase = { id: 'order-purchase', sellerPubky: STORE_SELLER, buyerPubky: VIEWER, lines: [] };
const sale = { id: 'order-sale', sellerPubky: VIEWER, buyerPubky: OTHER_BUYER, lines: [] };

describe('CommerceController seller side in a store', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: VIEWER });
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
