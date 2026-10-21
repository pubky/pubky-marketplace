import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { createCommerceCatalogEntryFixture } from '@/test/fixtures/commerce/commerce';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { useMarketplaceReviews, useSellerRatedListingCount } from './useMarketplaceReviews';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    fetchSellerReviews: vi.fn(),
    fetchListingReviews: vi.fn(),
    getCatalogEntriesBySeller: vi.fn(),
  },
}));

const SELLER = 'y'.repeat(52);

describe('useMarketplaceReviews', () => {
  beforeEach(() => {
    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue({ status: 'ok', reviews: [] });
  });

  it('does not return a refresh action — no caller in this workspace used it', async () => {
    const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current).not.toHaveProperty('refresh');
    expect(Object.keys(result.current).sort()).toEqual(['hasMore', 'isFetching', 'loadMore', 'reviews', 'status']);
  });
});

describe('useSellerRatedListingCount', () => {
  const trusted = {
    orders: 1,
    buyers: 1,
    sumBuyerMeans: 5,
    weightedSum: 5,
    weightTotal: 1,
    histogram: [0, 0, 0, 0, 1] as [number, number, number, number, number],
    firstIat: 1_772_323_200,
    lastIat: 1_772_323_200,
    sellerBuyers: null,
    sumSellerBuyerMeans: null,
  };

  it('counts the listings with counted buyer reviews, never legacy or untrusted ones', async () => {
    vi.mocked(CommerceController.getCatalogEntriesBySeller).mockResolvedValue([
      createCommerceCatalogEntryFixture({
        listing_id: 'counted',
        listing_reputation: { avg: 5, count: 1, verifiedCount: 1, buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: trusted } },
      }),
      createCommerceCatalogEntryFixture({
        listing_id: 'untrusted',
        listing_reputation: { avg: 5, count: 1, verifiedCount: 1, buckets: { ['x'.repeat(52)]: trusted } },
      }),
      createCommerceCatalogEntryFixture({
        listing_id: 'legacy',
        listing_reputation: { avg: 5, count: 1, verifiedCount: 1 },
      }),
      createCommerceCatalogEntryFixture({ listing_id: 'unreviewed', listing_reputation: null }),
    ]);

    const { result } = renderHook(() => useSellerRatedListingCount(SELLER));

    await waitFor(() => expect(result.current).toBe(1));
  });
});
