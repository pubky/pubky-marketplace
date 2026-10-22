import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceIndexedReviewsResult } from '@/application/commerce/commerce';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';
import { REVIEW_SORT_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';
import { toast } from '@/molecules/Toaster/use-toast';
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

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const SELLER = 'y'.repeat(52);
const REVIEWER = 'a'.repeat(52);

function review(reviewId: string): CommerceIndexedReview {
  return {
    reviewId,
    uri: `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/${reviewId}`,
    reviewerId: REVIEWER,
    subjectId: SELLER,
    listingOwnerId: SELLER,
    listingId: 'boots_01',
    role: 'buyer_reviewing_seller',
    ratingOverall: 4,
    text: reviewId,
    verified: false,
    attestorId: null,
    editedLate: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    revision: 1,
    moderation: null,
    response: null,
  };
}

/** A page of `count` reviews whose ids start with `prefix`, so a test can tell which order a list came from. */
function page(
  prefix: string,
  count = MARKETPLACE_REVIEWS_PAGE_SIZE,
  sortApplied = false,
): CommerceIndexedReviewsResult {
  return {
    status: 'ok',
    reviews: Array.from({ length: count }, (_, index) => review(`${prefix}${String(index).padStart(2, '0')}`)),
    sortApplied,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ids = (reviews: CommerceIndexedReview[]) => reviews.map(({ reviewId }) => reviewId);
const lastSellerCall = () => vi.mocked(CommerceController.fetchSellerReviews).mock.lastCall;

describe('useMarketplaceReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue({
      status: 'ok',
      reviews: [],
      sortApplied: false,
    });
  });

  it('does not return a refresh action — no caller in this workspace used it', async () => {
    const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current).not.toHaveProperty('refresh');
    expect(Object.keys(result.current).sort()).toEqual([
      'hasMore',
      'isFetching',
      'isReordering',
      'loadMore',
      'reviews',
      'setSort',
      'sort',
      'sortSupported',
      'status',
    ]);
  });

  describe('sort', () => {
    it('sends no sort parameter by default, on the seller and the listing stream', async () => {
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(page('a', 1));
      const seller = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      const listing = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER, listingId: 'boots_01' }));
      await waitFor(() => expect(seller.result.current.status).toBe('ok'));
      await waitFor(() => expect(listing.result.current.status).toBe('ok'));

      expect(seller.result.current.sort).toBe('newest');
      expect(lastSellerCall()?.[1]).toEqual({ skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: undefined });
      expect(vi.mocked(CommerceController.fetchListingReviews).mock.lastCall?.[2]).toEqual({
        skip: 0,
        limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
        sort: undefined,
      });
    });

    it.each(['value', 'rating_desc', 'rating_asc'] as const)('maps %s to the same index parameter', async (sort) => {
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('n', 1));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.status).toBe('ok'));
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('s', 1, true));

      act(() => result.current.setSort(sort));

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('s00'));
      expect(lastSellerCall()?.[1]).toEqual({ skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort });
      expect(result.current.sort).toBe(sort);
      expect(toast).not.toHaveBeenCalled();
    });

    it('sends the sort to the listing stream as well', async () => {
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(page('n', 1));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER, listingId: 'boots_01' }));
      await waitFor(() => expect(result.current.status).toBe('ok'));
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(page('s', 1, true));

      act(() => result.current.setSort('value'));

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('s00'));
      expect(vi.mocked(CommerceController.fetchListingReviews).mock.lastCall).toEqual([
        SELLER,
        'boots_01',
        { skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: 'value' },
      ]);
    });

    it('goes back to the default parameter-free request when Newest is chosen again', async () => {
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('n', 1));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.status).toBe('ok'));
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('s', 1, true));
      act(() => result.current.setSort('value'));
      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('s00'));

      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('n', 1));
      act(() => result.current.setSort('newest'));

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('n00'));
      expect(lastSellerCall()?.[1]).toEqual({ skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: undefined });
    });

    it('restarts paging on a sort change: the new order starts at skip 0 and pages from there', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n0'));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.hasMore).toBe(true));
      fetch.mockResolvedValueOnce(page('n1'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.reviews).toHaveLength(2 * MARKETPLACE_REVIEWS_PAGE_SIZE));
      expect(lastSellerCall()?.[1]).toMatchObject({ skip: MARKETPLACE_REVIEWS_PAGE_SIZE });

      fetch.mockResolvedValueOnce(page('v0', MARKETPLACE_REVIEWS_PAGE_SIZE, true));
      act(() => result.current.setSort('value'));
      await waitFor(() => expect(ids(result.current.reviews)[0]).toBe('v000'));

      expect(lastSellerCall()?.[1]).toEqual({ skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: 'value' });
      expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE);
      expect(result.current.hasMore).toBe(true);

      fetch.mockResolvedValueOnce(page('v1', MARKETPLACE_REVIEWS_PAGE_SIZE, true));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.reviews).toHaveLength(2 * MARKETPLACE_REVIEWS_PAGE_SIZE));
      expect(lastSellerCall()?.[1]).toEqual({
        skip: MARKETPLACE_REVIEWS_PAGE_SIZE,
        limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
        sort: 'value',
      });
      const all = ids(result.current.reviews);
      expect(new Set(all).size).toBe(all.length);
      expect(all.every((id) => id.startsWith('v'))).toBe(true);
    });

    it('pages by the count the index returned, so an item shown twice never shifts the next page', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('p'));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.hasMore).toBe(true));
      const repeated: CommerceIndexedReviewsResult = {
        status: 'ok',
        sortApplied: false,
        reviews: [
          review('p00'),
          ...Array.from({ length: MARKETPLACE_REVIEWS_PAGE_SIZE - 1 }, (_, i) => review(`q${i}`)),
        ],
      };
      fetch.mockResolvedValueOnce(repeated);
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.reviews).toHaveLength(2 * MARKETPLACE_REVIEWS_PAGE_SIZE - 1));

      fetch.mockResolvedValueOnce(page('r'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.reviews).toHaveLength(3 * MARKETPLACE_REVIEWS_PAGE_SIZE - 1));

      expect(lastSellerCall()?.[1]).toMatchObject({ skip: 2 * MARKETPLACE_REVIEWS_PAGE_SIZE });
    });

    it('discards a slow response of the previous sort that lands after the new sort answered', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n'));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.status).toBe('ok'));

      const slow = deferred<CommerceIndexedReviewsResult>();
      const fast = deferred<CommerceIndexedReviewsResult>();
      fetch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
      act(() => result.current.setSort('value'));
      act(() => result.current.setSort('rating_desc'));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

      await act(async () => fast.resolve(page('f', 2, true)));
      await waitFor(() => expect(ids(result.current.reviews)).toEqual(['f00', 'f01']));
      await act(async () => slow.resolve(page('s', 3, true)));

      expect(ids(result.current.reviews)).toEqual(['f00', 'f01']);
      expect(result.current.sort).toBe('rating_desc');
      expect(result.current.isFetching).toBe(false);
      expect(result.current.isReordering).toBe(false);
    });

    it('discards a late "load more" of the previous sort', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n'));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.hasMore).toBe(true));

      const lateMore = deferred<CommerceIndexedReviewsResult>();
      fetch.mockReturnValueOnce(lateMore.promise);
      act(() => result.current.loadMore());
      const sorted = deferred<CommerceIndexedReviewsResult>();
      fetch.mockReturnValueOnce(sorted.promise);
      act(() => result.current.setSort('rating_asc'));

      await act(async () => lateMore.resolve(page('late', 4)));
      expect(result.current.reviews).toHaveLength(0);
      expect(result.current.isFetching).toBe(true);

      await act(async () => sorted.resolve(page('s', 2, true)));
      await waitFor(() => expect(ids(result.current.reviews)).toEqual(['s00', 's01']));
      expect(result.current.hasMore).toBe(false);
      expect(result.current.isFetching).toBe(false);
    });

    it('reports a reorder while the first page of a new sort loads, with the toolbar state intact', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n', 3));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.status).toBe('ok'));
      expect(result.current.isReordering).toBe(false);

      const sorted = deferred<CommerceIndexedReviewsResult>();
      fetch.mockReturnValueOnce(sorted.promise);
      act(() => result.current.setSort('value'));

      await waitFor(() => expect(result.current.isReordering).toBe(true));
      expect(result.current.status).toBe('ok');
      expect(result.current.sort).toBe('value');
      await act(async () => sorted.resolve(page('s', 3, true)));
      await waitFor(() => expect(result.current.isReordering).toBe(false));
    });

    it('keeps an index that cannot sort working: no toast, the newest-first list stays, the sort is reported unsupported', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n'));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.hasMore).toBe(true));
      expect(result.current.sortSupported).toBe(true);

      fetch.mockResolvedValueOnce(page('o', MARKETPLACE_REVIEWS_PAGE_SIZE, false));
      act(() => result.current.setSort('rating_desc'));
      await waitFor(() => expect(result.current.sortSupported).toBe(false));

      expect(ids(result.current.reviews)[0]).toBe('o00');
      expect(result.current.sort).toBe('newest');
      expect(result.current.status).toBe('ok');
      expect(toast).not.toHaveBeenCalled();

      fetch.mockResolvedValueOnce(page('p', 2));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2));
      expect(lastSellerCall()?.[1]).toEqual({
        skip: MARKETPLACE_REVIEWS_PAGE_SIZE,
        limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
        sort: undefined,
      });
    });

    it('goes back to newest with one error toast when a sorted request fails, and keeps the section', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n', 2));
      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
      await waitFor(() => expect(result.current.status).toBe('ok'));

      fetch.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValueOnce(page('n', 2));
      act(() => result.current.setSort('value'));

      await waitFor(() => expect(result.current.sort).toBe('newest'));
      await waitFor(() => expect(ids(result.current.reviews)).toEqual(['n00', 'n01']));
      expect(result.current.status).toBe('ok');
      expect(result.current.sortSupported).toBe(true);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: REVIEW_SORT_COPY.failed });
    });

    it('answers unavailable, as before, when the default list cannot be read', async () => {
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce({ status: 'unavailable' });

      const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));

      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(toast).not.toHaveBeenCalled();
    });

    it('starts a new target in the default order and drops a late page of the previous target', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      const firstLoad = deferred<CommerceIndexedReviewsResult>();
      fetch.mockReturnValueOnce(firstLoad.promise);
      const { result, rerender } = renderHook(({ seller }) => useMarketplaceReviews({ sellerPubky: seller }), {
        initialProps: { seller: SELLER },
      });

      const other = 'z'.repeat(52);
      fetch.mockResolvedValueOnce(page('z', 2));
      rerender({ seller: other });
      await waitFor(() => expect(ids(result.current.reviews)).toEqual(['z00', 'z01']));
      await act(async () => firstLoad.resolve(page('late', 5)));

      expect(ids(result.current.reviews)).toEqual(['z00', 'z01']);
      expect(result.current.sort).toBe('newest');
    });
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
