import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { CommerceListingProjectionModelSchema } from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { CommerceController } from './commerce';

const BOOTS = `${ORDER_FIXTURE_SELLER}:boots`;

function projection(
  id: string,
  overrides: Partial<CommerceListingProjectionModelSchema> = {},
): CommerceListingProjectionModelSchema {
  const [sellerId, listingId] = id.split(':') as [string, string];
  return {
    id,
    seller_id: sellerId,
    listing_id: listingId,
    listing_revision: 1,
    content_hash: 'a'.repeat(64),
    server_revision: 1,
    state: 'available',
    available_quantity: 1,
    current_price: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
    auction_state: null,
    bid_count: 0,
    sync_status: 'synced',
    synced_at: 1,
    ...overrides,
  };
}

const refreshCount = (id: string) => useCommerceStore.getState().listingCardRefresh[id] ?? 0;

describe('CommerceController listing card refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCommerceStore.getState().reset();
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_BUYER });
    vi.spyOn(CommerceApplication, 'cacheMarketplaceListingProjection').mockResolvedValue(undefined);
  });

  describe('orders', () => {
    it('refreshes the cards of a listing when an order for it is first read', async () => {
      const order = createOrderFixture('pending_payment', { id: '018f47d2-6a27-7c23-a49d-000000000a01' });
      vi.spyOn(CommerceApplication, 'getMarketplaceOrder').mockResolvedValue(order);

      await CommerceController.getMarketplaceOrder(order.id);

      expect(refreshCount(BOOTS)).toBe(1);
    });

    it('refreshes again when the order moves to paid, and not while it is unchanged', async () => {
      const id = '018f47d2-6a27-7c23-a49d-000000000a02';
      const read = vi.spyOn(CommerceApplication, 'getMarketplaceOrder');

      read.mockResolvedValue(createOrderFixture('pending_payment', { id, revision: 1 }));
      await CommerceController.getMarketplaceOrder(id);
      await CommerceController.getMarketplaceOrder(id);
      expect(refreshCount(BOOTS)).toBe(1);

      read.mockResolvedValue(createOrderFixture('paid', { id, revision: 2 }));
      await CommerceController.getMarketplaceOrder(id);
      expect(refreshCount(BOOTS)).toBe(2);
      await CommerceController.getMarketplaceOrder(id);
      expect(refreshCount(BOOTS)).toBe(2);
    });

    it('refreshes every listing on an order list, once per order change', async () => {
      const first = createOrderFixture('paid', { id: '018f47d2-6a27-7c23-a49d-000000000a03' });
      const second = createOrderFixture('paid', {
        id: '018f47d2-6a27-7c23-a49d-000000000a04',
        lines: [{ ...first.lines[0]!, listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_hat` }],
      });
      vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([first, second]);

      await CommerceController.getMarketplaceOrders();
      await CommerceController.getMarketplaceOrders();

      expect(refreshCount(BOOTS)).toBe(1);
      expect(refreshCount(`${ORDER_FIXTURE_SELLER}:hat`)).toBe(1);
    });

    it('ignores an order that is not found and a line that is not a listing aggregate', async () => {
      vi.spyOn(CommerceApplication, 'getMarketplaceOrder').mockResolvedValue(null);
      await expect(CommerceController.getMarketplaceOrder('018f47d2-6a27-7c23-a49d-000000000a05')).resolves.toBeNull();

      const odd = createOrderFixture('paid', {
        id: '018f47d2-6a27-7c23-a49d-000000000a06',
        lines: [{ ...createOrderFixture('paid').lines[0]!, listingAggregateId: 'drop:not-a-listing' }],
      });
      vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([odd]);
      await CommerceController.getMarketplaceOrders();

      expect(useCommerceStore.getState().listingCardRefresh).toEqual({});
    });
  });

  describe('polled listing projections', () => {
    it('refreshes the cards when a poll sees the listing sell out', async () => {
      await CommerceController.cacheMarketplaceListingProjection(projection('p'.repeat(52) + ':camera'));
      expect(refreshCount('p'.repeat(52) + ':camera')).toBe(0);

      await CommerceController.cacheMarketplaceListingProjection(
        projection('p'.repeat(52) + ':camera', { state: 'sold', available_quantity: 0 }),
      );
      expect(refreshCount('p'.repeat(52) + ':camera')).toBe(1);
    });

    it('leaves the cards alone while the poll sees no change', async () => {
      const id = 'q'.repeat(52) + ':lamp';
      await CommerceController.cacheMarketplaceListingProjection(projection(id));
      await CommerceController.cacheMarketplaceListingProjection(projection(id, { server_revision: 2 }));
      await CommerceController.cacheMarketplaceListingProjection(projection(id, { server_revision: 3 }));

      expect(refreshCount(id)).toBe(0);
    });
  });

  it('refreshListingCards bumps the named listings', () => {
    CommerceController.refreshListingCards([BOOTS, `${ORDER_FIXTURE_SELLER}:hat`]);
    expect(refreshCount(BOOTS)).toBe(1);
    expect(refreshCount(`${ORDER_FIXTURE_SELLER}:hat`)).toBe(1);
  });
});
