import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceIndexedReviewsResult } from '@/application/commerce/commerce';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';
import { REVIEW_FILTER_COPY, REVIEW_SORT_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { resetAttestorKeyWindows, setAttestorProfileKeyWindows } from '@/libs/commerce/attestor-key-windows';
import type { CommerceIndexedReview, CommerceReviewMatch } from '@/models/commerce/commerce.schema';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
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
const VIEWER = 'v'.repeat(52);

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
  filtered: { filterApplied: boolean; matched: CommerceReviewMatch | null } = { filterApplied: false, matched: null },
): CommerceIndexedReviewsResult {
  return {
    status: 'ok',
    reviews: Array.from({ length: count }, (_, index) => review(`${prefix}${String(index).padStart(2, '0')}`)),
    sortApplied,
    ...filtered,
  };
}

const MATCHED: CommerceReviewMatch = { buyers: 3, orders: 4, avg: 4.8 };

/** A page an index answered to a reviewer filter: the envelope, with the figures of the matches. */
const filteredPage = (
  prefix: string,
  count = MARKETPLACE_REVIEWS_PAGE_SIZE,
  matched: CommerceReviewMatch | null = MATCHED,
) => page(prefix, count, false, { filterApplied: true, matched });

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
    window.sessionStorage.clear();
    useAuthStore.setState({ currentUserPubky: VIEWER });
    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue({
      status: 'ok',
      reviews: [],
      sortApplied: false,
      filterApplied: false,
      matched: null,
    });
  });

  it('does not return a refresh action — no caller in this workspace used it', async () => {
    const { result } = renderHook(() => useMarketplaceReviews({ sellerPubky: SELLER }));
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current).not.toHaveProperty('refresh');
    expect(Object.keys(result.current).sort()).toEqual([
      'filter',
      'filterRejected',
      'filterSummary',
      'filtersAvailable',
      'hasMore',
      'isFetching',
      'isReordering',
      'loadMore',
      'reviews',
      'setFilter',
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
        filterApplied: false,
        matched: null,
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

  describe('reviewer filter', () => {
    const request = (filter: Record<string, unknown>) => ({
      skip: 0,
      limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
      sort: undefined,
      filter,
    });
    const lastFilter = () => (lastSellerCall()?.[1] as { filter?: unknown } | undefined)?.filter;

    async function loaded(target: { sellerPubky: string; listingId?: string } = { sellerPubky: SELLER }) {
      const hook = renderHook(() => useMarketplaceReviews(target));
      await waitFor(() => expect(hook.result.current.status).toBe('ok'));
      return hook;
    }

    it('sends none of the viewer parameters by default, signed in, on the seller and the listing stream', async () => {
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(page('a', 1));
      const seller = await loaded();
      const listing = await loaded({ sellerPubky: SELLER, listingId: 'boots_01' });

      expect(seller.result.current.filter).toEqual({ kind: 'all' });
      expect(seller.result.current.filterSummary).toBeNull();
      expect(seller.result.current.filtersAvailable).toBe(true);
      expect(lastFilter()).toBeUndefined();
      expect(
        (vi.mocked(CommerceController.fetchListingReviews).mock.lastCall?.[2] as { filter?: unknown }).filter,
      ).toBe(undefined);
      expect(listing.result.current.reviews).toHaveLength(1);
    });

    it.each([
      ['following', { kind: 'following' }, { viewerId: VIEWER, reach: 'following' }],
      ['wot', { kind: 'wot' }, { viewerId: VIEWER, reach: 'wot', depth: 2 }],
      [
        'tagged',
        { kind: 'tagged', labels: ['bitcoin', 'camera'] },
        { viewerId: VIEWER, taggedLabels: ['bitcoin', 'camera'] },
      ],
    ] as const)('maps the %s chip to its index parameters', async (_name, chip, expected) => {
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValue(filteredPage('f', 1));

      act(() => result.current.setFilter(chip));

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('f00'));
      expect(lastSellerCall()?.[1]).toEqual(request(expected));
      expect(result.current.filter).toEqual(chip);
      expect(toast).not.toHaveBeenCalled();
    });

    it('sends the filter to the listing stream as well', async () => {
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(page('n', 1));
      const { result } = await loaded({ sellerPubky: SELLER, listingId: 'boots_01' });
      vi.mocked(CommerceController.fetchListingReviews).mockResolvedValue(filteredPage('f', 1));

      act(() => result.current.setFilter({ kind: 'following' }));

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('f00'));
      expect(vi.mocked(CommerceController.fetchListingReviews).mock.lastCall).toEqual([
        SELLER,
        'boots_01',
        request({ viewerId: VIEWER, reach: 'following' }),
      ]);
    });

    it('composes with every sort option', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      fetch.mockResolvedValue(page('f', 1, true, { filterApplied: true, matched: MATCHED }));
      act(() => result.current.setFilter({ kind: 'wot' }));
      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('f00'));

      for (const sort of ['value', 'rating_desc', 'rating_asc'] as const) {
        act(() => result.current.setSort(sort));
        await waitFor(() => expect(result.current.sort).toBe(sort));
        await waitFor(() => expect(lastSellerCall()?.[1]).toMatchObject({ sort }));
        expect(lastSellerCall()?.[1]).toEqual({
          skip: 0,
          limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
          sort,
          filter: { viewerId: VIEWER, reach: 'wot', depth: 2 },
        });
        expect(result.current.filter).toEqual({ kind: 'wot' });
      }
    });

    it('keeps the filter when the sort changes back to Newest', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      fetch.mockResolvedValue(page('f', 1, true, { filterApplied: true, matched: MATCHED }));
      act(() => result.current.setFilter({ kind: 'following' }));
      await waitFor(() => expect(result.current.filter).toEqual({ kind: 'following' }));
      act(() => result.current.setSort('value'));
      await waitFor(() => expect(lastSellerCall()?.[1]).toMatchObject({ sort: 'value' }));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      act(() => result.current.setSort('newest'));

      await waitFor(() => expect(lastSellerCall()?.[1]).toEqual(request({ viewerId: VIEWER, reach: 'following' })));
      expect(result.current.filter).toEqual({ kind: 'following' });
      expect(result.current.sortSupported).toBe(true);
    });

    it('sends the viewer to nobody for a signed-out visitor, who has no filters', async () => {
      useAuthStore.setState({ currentUserPubky: null });
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      expect(result.current.filtersAvailable).toBe(false);

      act(() => result.current.setFilter({ kind: 'following' }));
      act(() => result.current.setFilter({ kind: 'tagged', labels: ['bitcoin'] }));

      expect(result.current.filter).toEqual({ kind: 'all' });
      for (const [, page] of fetch.mock.calls) expect(page).not.toHaveProperty('filter', expect.anything());
      expect(JSON.stringify(fetch.mock.calls)).not.toContain(VIEWER);
    });

    it('goes back to the unfiltered request when the viewer signs out', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(filteredPage('f', 1));
      const { result } = await loaded();
      act(() => result.current.setFilter({ kind: 'following' }));
      await waitFor(() => expect(lastFilter()).toEqual({ viewerId: VIEWER, reach: 'following' }));

      fetch.mockResolvedValue(page('n', 1));
      act(() => useAuthStore.setState({ currentUserPubky: null }));

      await waitFor(() => expect(lastFilter()).toBeUndefined());
      expect(result.current.filter).toEqual({ kind: 'all' });
      expect(result.current.filtersAvailable).toBe(false);
    });

    it('normalizes the tag labels: trimmed, lowercase, de-duplicated, at most five', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      fetch.mockResolvedValue(filteredPage('f', 1));

      act(() =>
        result.current.setFilter({
          kind: 'tagged',
          labels: [' Bitcoin ', 'bitcoin', 'CAMERA', 'a b', '', 'one', 'two', 'three', 'four'],
        }),
      );

      await waitFor(() => expect(result.current.reviews[0]?.reviewId).toBe('f00'));
      expect(lastFilter()).toEqual({ viewerId: VIEWER, taggedLabels: ['bitcoin', 'camera', 'one', 'two', 'three'] });
      expect(result.current.filter).toEqual({
        kind: 'tagged',
        labels: ['bitcoin', 'camera', 'one', 'two', 'three'],
      });
    });

    it('treats an empty tag selection as no filter: nothing is sent and no request is made', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(page('n', 1));
      const { result } = await loaded();
      const before = fetch.mock.calls.length;

      act(() => result.current.setFilter({ kind: 'tagged', labels: ['  ', ''] }));

      expect(result.current.filter).toEqual({ kind: 'all' });
      expect(fetch.mock.calls).toHaveLength(before);
    });

    it('does not ask again for the filter that is already chosen', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValue(filteredPage('f', 1));
      const { result } = await loaded();
      act(() => result.current.setFilter({ kind: 'tagged', labels: ['bitcoin'] }));
      await waitFor(() => expect(result.current.filter).toEqual({ kind: 'tagged', labels: ['bitcoin'] }));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      const before = fetch.mock.calls.length;

      act(() => result.current.setFilter({ kind: 'tagged', labels: [' Bitcoin'] }));

      expect(fetch.mock.calls).toHaveLength(before);
    });

    describe('the header summary', () => {
      it('holds the place while the index answers, then carries the figures of the matches', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        const answer = deferred<CommerceIndexedReviewsResult>();
        fetch.mockReturnValueOnce(answer.promise);

        act(() => result.current.setFilter({ kind: 'following' }));

        expect(result.current.filterSummary).toEqual({ state: 'loading', filter: { kind: 'following' } });
        await act(async () => answer.resolve(filteredPage('f', 2)));
        await waitFor(() =>
          expect(result.current.filterSummary).toEqual({
            state: 'ready',
            filter: { kind: 'following' },
            matched: MATCHED,
          }),
        );
      });

      it('reports zero matched buyers as the figures they are, never as the figure of everyone', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        const none = { buyers: 0, orders: 0, avg: null };
        fetch.mockResolvedValueOnce(filteredPage('f', 0, none));

        act(() => result.current.setFilter({ kind: 'wot' }));

        await waitFor(() =>
          expect(result.current.filterSummary).toEqual({ state: 'ready', filter: { kind: 'wot' }, matched: none }),
        );
        expect(result.current.reviews).toEqual([]);
      });

      it('is unscored when the application could not scope the figures to the trusted attestors', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(filteredPage('f', 2, null));

        act(() => result.current.setFilter({ kind: 'following' }));

        await waitFor(() =>
          expect(result.current.filterSummary).toEqual({ state: 'unscored', filter: { kind: 'following' } }),
        );
      });

      it('does not move with the sort', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValue(filteredPage('f', 2));
        const { result } = await loaded();
        act(() => result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(result.current.filterSummary?.state).toBe('ready'));
        const before = result.current.filterSummary;

        act(() => result.current.setSort('rating_desc'));
        await waitFor(() => expect(result.current.sort).toBe('rating_desc'));
        await waitFor(() => expect(result.current.filterSummary?.state).toBe('ready'));

        expect(result.current.filterSummary).toEqual(before);
      });
    });

    describe('paging', () => {
      it('restarts at skip 0 on a chip change and pages by the count the index returned, without duplicates', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n0'));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(page('n1'));
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.reviews).toHaveLength(2 * MARKETPLACE_REVIEWS_PAGE_SIZE));

        fetch.mockResolvedValueOnce(filteredPage('f0'));
        act(() => result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(ids(result.current.reviews)[0]).toBe('f000'));
        expect(lastSellerCall()?.[1]).toEqual(request({ viewerId: VIEWER, reach: 'following' }));
        expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE);

        fetch.mockResolvedValueOnce(filteredPage('f1'));
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.reviews).toHaveLength(2 * MARKETPLACE_REVIEWS_PAGE_SIZE));
        expect(lastSellerCall()?.[1]).toEqual({
          skip: MARKETPLACE_REVIEWS_PAGE_SIZE,
          limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
          sort: undefined,
          filter: { viewerId: VIEWER, reach: 'following' },
        });
        const all = ids(result.current.reviews);
        expect(new Set(all).size).toBe(all.length);
        expect(all.every((id) => id.startsWith('f'))).toBe(true);
      });

      it('keeps the figures of the first page while later pages load', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 1));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(filteredPage('f0'));
        act(() => result.current.setFilter({ kind: 'wot' }));
        await waitFor(() => expect(result.current.filterSummary?.state).toBe('ready'));
        const summary = result.current.filterSummary;
        fetch.mockResolvedValueOnce(filteredPage('f1', 1, { buyers: 9, orders: 9, avg: 1 }));

        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.reviews.length).toBeGreaterThan(MARKETPLACE_REVIEWS_PAGE_SIZE));

        expect(result.current.filterSummary).toEqual(summary);
      });
    });

    describe('interleaving', () => {
      it('discards a slow response of the previous chip that lands after the new chip answered', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n'));
        const { result } = await loaded();
        const slow = deferred<CommerceIndexedReviewsResult>();
        const fast = deferred<CommerceIndexedReviewsResult>();
        fetch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

        act(() => result.current.setFilter({ kind: 'following' }));
        act(() => result.current.setFilter({ kind: 'wot' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
        await act(async () => fast.resolve(filteredPage('w', 2, { buyers: 2, orders: 2, avg: 3 })));
        await waitFor(() => expect(ids(result.current.reviews)).toEqual(['w00', 'w01']));
        await act(async () => slow.resolve(filteredPage('f', 3, { buyers: 7, orders: 7, avg: 5 })));

        expect(ids(result.current.reviews)).toEqual(['w00', 'w01']);
        expect(result.current.filter).toEqual({ kind: 'wot' });
        expect(result.current.filterSummary).toEqual({
          state: 'ready',
          filter: { kind: 'wot' },
          matched: { buyers: 2, orders: 2, avg: 3 },
        });
        expect(result.current.isFetching).toBe(false);
        expect(result.current.isReordering).toBe(false);
      });

      it('discards a late failure of the previous chip: no toast, no fall back to All', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n'));
        const { result } = await loaded();
        const slow = deferred<CommerceIndexedReviewsResult>();
        const fast = deferred<CommerceIndexedReviewsResult>();
        fetch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
        act(() => result.current.setFilter({ kind: 'following' }));
        act(() => result.current.setFilter({ kind: 'wot' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
        await act(async () => fast.resolve(filteredPage('w', 2)));
        await waitFor(() => expect(ids(result.current.reviews)).toEqual(['w00', 'w01']));

        await act(async () => slow.resolve({ status: 'unavailable' }));

        expect(toast).not.toHaveBeenCalled();
        expect(result.current.filter).toEqual({ kind: 'wot' });
        expect(ids(result.current.reviews)).toEqual(['w00', 'w01']);
      });

      it('discards a late "load more" of the previous chip', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n'));
        const { result } = await loaded();
        const lateMore = deferred<CommerceIndexedReviewsResult>();
        fetch.mockReturnValueOnce(lateMore.promise);
        act(() => result.current.loadMore());
        const filtered = deferred<CommerceIndexedReviewsResult>();
        fetch.mockReturnValueOnce(filtered.promise);
        act(() => result.current.setFilter({ kind: 'following' }));

        await act(async () => lateMore.resolve(page('late', 4)));
        expect(result.current.reviews).toHaveLength(0);

        await act(async () => filtered.resolve(filteredPage('f', 2)));
        await waitFor(() => expect(ids(result.current.reviews)).toEqual(['f00', 'f01']));
        expect(result.current.hasMore).toBe(false);
      });
    });

    describe('an index before IX4', () => {
      it('shows the full list, hides the chips, shows no toast, and does not filter it client-side', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        expect(result.current.filtersAvailable).toBe(true);

        fetch.mockResolvedValueOnce(page('o', 3));
        act(() => result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(result.current.filtersAvailable).toBe(false));

        expect(ids(result.current.reviews)).toEqual(['o00', 'o01', 'o02']);
        expect(result.current.filter).toEqual({ kind: 'all' });
        expect(result.current.filterSummary).toBeNull();
        expect(result.current.status).toBe('ok');
        expect(toast).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it('stops sending the filter, and remembers for the session', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const first = await loaded();
        fetch.mockResolvedValueOnce(page('o', MARKETPLACE_REVIEWS_PAGE_SIZE));
        act(() => first.result.current.setFilter({ kind: 'wot' }));
        await waitFor(() => expect(first.result.current.filtersAvailable).toBe(false));
        fetch.mockResolvedValueOnce(page('p', 2));
        act(() => first.result.current.loadMore());
        await waitFor(() => expect(first.result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2));
        expect(lastFilter()).toBeUndefined();
        first.unmount();

        fetch.mockResolvedValueOnce(page('q', 1));
        const next = await loaded({ sellerPubky: 'z'.repeat(52) });

        expect(next.result.current.filtersAvailable).toBe(false);
        expect(lastFilter()).toBeUndefined();
      });

      it('is the same when the filter comes with a sort the index also ignored', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(page('o', 2));
        act(() => result.current.setSort('rating_desc'));
        await waitFor(() => expect(result.current.sortSupported).toBe(false));
        fetch.mockResolvedValueOnce(page('p', 2));

        act(() => result.current.setFilter({ kind: 'following' }));

        await waitFor(() => expect(result.current.filtersAvailable).toBe(false));
        expect(ids(result.current.reviews)).toEqual(['p00', 'p01']);
        expect(toast).not.toHaveBeenCalled();
      });
    });

    it('goes back to All with one error toast when a filtered request fails, and keeps the section', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n', 2));
      const { result } = await loaded();

      fetch.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValueOnce(page('n', 2));
      act(() => result.current.setFilter({ kind: 'following' }));

      await waitFor(() => expect(result.current.filter).toEqual({ kind: 'all' }));
      await waitFor(() => expect(ids(result.current.reviews)).toEqual(['n00', 'n01']));
      expect(result.current.status).toBe('ok');
      expect(result.current.filtersAvailable).toBe(true);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: REVIEW_FILTER_COPY.failed });
      expect(lastFilter()).toBeUndefined();
    });

    it('keeps the sort when a filtered request fails', async () => {
      const fetch = vi.mocked(CommerceController.fetchSellerReviews);
      fetch.mockResolvedValueOnce(page('n', 2));
      const { result } = await loaded();
      fetch.mockResolvedValueOnce(page('s', 2, true));
      act(() => result.current.setSort('value'));
      await waitFor(() => expect(result.current.sort).toBe('value'));

      fetch.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValueOnce(page('s', 2, true));
      act(() => result.current.setFilter({ kind: 'wot' }));

      await waitFor(() => expect(result.current.filter).toEqual({ kind: 'all' }));
      await waitFor(() =>
        expect(lastSellerCall()?.[1]).toEqual({ skip: 0, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: 'value' }),
      );
      expect(result.current.sort).toBe('value');
      expect(toast).toHaveBeenCalledTimes(1);
    });

    describe('trusted attestor windows', () => {
      const NARROWED = [{ pubky: 'k'.repeat(52), validUntil: null, compromisedFrom: 0 }];

      afterEach(() => {
        resetAttestorKeyWindows();
      });

      it('reloads a filtered list and its figures when a verified profile narrows the trusted attestors', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(filteredPage('f', 2));
        act(() => result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(result.current.filterSummary?.state).toBe('ready'));
        const narrowed = { buyers: 1, orders: 1, avg: 5 };
        fetch.mockResolvedValueOnce(filteredPage('g', 1, narrowed));

        act(() => setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, NARROWED));

        await waitFor(() => expect(ids(result.current.reviews)).toEqual(['g00']));
        expect(result.current.filterSummary).toEqual({
          state: 'ready',
          filter: { kind: 'following' },
          matched: narrowed,
        });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(lastFilter()).toEqual({ viewerId: VIEWER, reach: 'following' });
      });

      it('keeps the unfiltered list and its pages when the windows change', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n'));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(page('m', 2));
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2));

        act(() => setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, NARROWED));
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2);
      });

      it('keeps the pages of an index that ignored the filter when the windows change', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce(page('e'));
        act(() => result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(result.current.filtersAvailable).toBe(false));
        fetch.mockResolvedValueOnce(page('m', 2));
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2));

        act(() => setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, NARROWED));
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE + 2);
      });
    });

    describe('a later filtered page', () => {
      async function filteredFirstPage() {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const hook = await loaded();
        fetch.mockResolvedValueOnce(filteredPage('f'));
        act(() => hook.result.current.setFilter({ kind: 'following' }));
        await waitFor(() => expect(hook.result.current.hasMore).toBe(true));
        return hook;
      }

      it('stops the paging, appending nothing, when the index refuses it', async () => {
        const { result } = await filteredFirstPage();
        vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce({ status: 'rejected' });

        act(() => result.current.loadMore());

        await waitFor(() => expect(result.current.hasMore).toBe(false));
        expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE);
        expect(result.current.isFetching).toBe(false);
      });

      it("stops the paging, appending nothing, when the index answers with everyone's list", async () => {
        const { result } = await filteredFirstPage();
        vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce(page('x', 3));

        act(() => result.current.loadMore());

        await waitFor(() => expect(result.current.hasMore).toBe(false));
        expect(ids(result.current.reviews).every((id) => id.startsWith('f'))).toBe(true);
        expect(result.current.reviews).toHaveLength(MARKETPLACE_REVIEWS_PAGE_SIZE);
        expect(result.current.isFetching).toBe(false);
      });
    });

    describe('an index that answers 400', () => {
      it('shows the refusal, keeps the filter chosen, and shows no toast and no list', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();

        fetch.mockResolvedValueOnce({ status: 'rejected' });
        act(() => result.current.setFilter({ kind: 'tagged', labels: ['bitcoin'] }));

        await waitFor(() => expect(result.current.filterRejected).toBe(true));
        expect(result.current.filter).toEqual({ kind: 'tagged', labels: ['bitcoin'] });
        expect(result.current.reviews).toEqual([]);
        expect(result.current.hasMore).toBe(false);
        expect(result.current.status).toBe('ok');
        expect(result.current.filtersAvailable).toBe(true);
        expect(result.current.filterSummary).toEqual({
          state: 'unscored',
          filter: { kind: 'tagged', labels: ['bitcoin'] },
        });
        expect(toast).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
        act(() => result.current.loadMore());
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it('clears the refusal when another chip is chosen', async () => {
        const fetch = vi.mocked(CommerceController.fetchSellerReviews);
        fetch.mockResolvedValueOnce(page('n', 2));
        const { result } = await loaded();
        fetch.mockResolvedValueOnce({ status: 'rejected' });
        act(() => result.current.setFilter({ kind: 'tagged', labels: ['bad'] }));
        await waitFor(() => expect(result.current.filterRejected).toBe(true));

        fetch.mockResolvedValueOnce(page('n', 2));
        act(() => result.current.setFilter({ kind: 'all' }));

        await waitFor(() => expect(ids(result.current.reviews)).toEqual(['n00', 'n01']));
        expect(result.current.filterRejected).toBe(false);
      });
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
