'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CommerceIndexedReviewsResult, CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';
import { REVIEW_FILTER_COPY, REVIEW_SORT_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAttestorKeyWindowsVersion } from '@/hooks/useAttestorKeyWindows/useAttestorKeyWindows';
import { countedSnippetReputation } from '@/libs/commerce/review-counting';
import {
  isActiveReviewFilter,
  MARKETPLACE_REVIEW_FILTER_DEFAULT,
  type MarketplaceReviewFilter,
  type MarketplaceReviewFilterRequest,
  type MarketplaceReviewFilterSummary,
  normalizeReviewFilter,
  rememberReviewFiltersUnsupported,
  reviewFilterKey,
  reviewFilterRequest,
  reviewFiltersKnownUnsupported,
} from '@/libs/commerce/review-filter';
import {
  MARKETPLACE_REVIEW_SORT_DEFAULT,
  type MarketplaceReviewSort,
  reviewSortParam,
} from '@/libs/commerce/review-sort';
import type {
  CommerceIndexedReview,
  CommerceReputationSnippet,
  CommerceReviewMatch,
} from '@/models/commerce/commerce.schema';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * One product's own rating for its listing page: `undefined` while loading,
 * `null` when it has none (the page shows "No rating yet"), `unavailable`
 * when the index did not answer (the page shows nothing).
 */
export function useListingRating(sellerPubky: string, listingId: string) {
  const keyWindowsVersion = useAttestorKeyWindowsVersion();
  const [rating, setRating] = useState<CommerceReputationSnippet | null | 'unavailable' | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setRating(undefined);
    CommerceController.fetchListingRating(sellerPubky, listingId)
      .then((result) => {
        if (active) setRating(result);
      })
      .catch(() => {
        if (active) setRating('unavailable');
      });
    return () => {
      active = false;
    };
  }, [sellerPubky, listingId, keyWindowsVersion]);

  return rating;
}

/**
 * The seller's public reputation overview for rating headers.
 *
 * Three-way honest state machine (never a fabricated number):
 * - `rated` — the index holds reviews; the summary renders.
 * - `new_seller` — a reputation-aware index confirmed zero reviews; the
 *   explicit "New seller" state renders.
 * - `unavailable` — no reputation-aware index answered (old deployment,
 *   sandbox, or unreachable); NO reputation surface renders at all.
 * `loading` is the initial in-flight state.
 */
export function useSellerReputation(sellerPubky: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const keyWindowsVersion = useAttestorKeyWindowsVersion();
  const [overview, setOverview] = useState<CommerceSellerReputationOverview | { status: 'loading' }>({
    status: 'loading',
  });

  useEffect(() => {
    if (!enabled) {
      setOverview({ status: 'unavailable' });
      return;
    }

    let active = true;
    setOverview({ status: 'loading' });
    CommerceController.fetchSellerReputation(sellerPubky)
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch(() => {
        if (active) setOverview({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [sellerPubky, enabled, keyWindowsVersion]);

  return overview;
}

/**
 * How many of the seller's indexed listings this device holds have counted
 * buyer reviews (trusted buckets, card rule): the L of the storefront's
 * "Products rated 4.6 across L listings". Counts only what the catalog
 * cache holds, so it never over-counts; 0 while loading.
 */
export function useSellerRatedListingCount(sellerPubky: string): number {
  const entries = useLiveQuery(() => CommerceController.getCatalogEntriesBySeller(sellerPubky), [sellerPubky]);
  return (entries ?? []).filter((entry) => {
    const counted = entry.listing_reputation ? countedSnippetReputation(entry.listing_reputation) : null;
    return counted !== null && counted.buyers > 0;
  }).length;
}

export interface MarketplaceReviewsTarget {
  sellerPubky: string;
  /** When set, the list is the listing's buyer reviews; otherwise the seller's. */
  listingId?: string;
}

export interface MarketplaceReviewsState {
  status: 'loading' | 'ok' | 'unavailable';
  reviews: CommerceIndexedReview[];
  /** True while any page fetch is in flight. */
  isFetching: boolean;
  /** True while a changed sort loads its first page: the list renders a skeleton. */
  isReordering: boolean;
  /** True when the last page came back full, so another page may exist. */
  hasMore: boolean;
  loadMore: () => void;
  /** The order of the list. Always `newest` once the index showed it cannot sort. */
  sort: MarketplaceReviewSort;
  /** Changes the order; the list restarts from its first page. */
  setSort: (sort: MarketplaceReviewSort) => void;
  /** False once the index answered a sort request with a plain newest-first list (an index before IX4). */
  sortSupported: boolean;
  /** The reviewer filter of the list. Always `all` for a signed-out visitor and once the index showed it cannot filter. */
  filter: MarketplaceReviewFilter;
  /** Changes the filter; the list restarts from its first page. */
  setFilter: (filter: MarketplaceReviewFilter) => void;
  /** True for a signed-in visitor on an index that has not shown it ignores the filters. */
  filtersAvailable: boolean;
  /** What the active filter puts in the rating header; null under `all`. */
  filterSummary: MarketplaceReviewFilterSummary | null;
  /** True when the index answered 400 to the active filter: the list is empty and the reason is shown, not hidden. */
  filterRejected: boolean;
}

async function fetchReviewsPage(
  { sellerPubky, listingId }: MarketplaceReviewsTarget,
  skip: number,
  sort: MarketplaceReviewSort,
  filter: MarketplaceReviewFilterRequest | undefined,
): Promise<CommerceIndexedReviewsResult> {
  const page = { skip, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: reviewSortParam(sort), filter };
  return listingId === undefined
    ? await CommerceController.fetchSellerReviews(sellerPubky, page)
    : await CommerceController.fetchListingReviews(sellerPubky, listingId, page);
}

/**
 * Paged review list for a seller or one listing, newest-indexed first from
 * everyone unless a sort or a reviewer filter is chosen. `unavailable` means
 * no review index serves this deployment — the caller renders no review
 * section rather than an empty one.
 *
 * Every request belongs to one epoch, which any change of target, sort,
 * filter or viewer ends: a page that answers after its epoch ended is
 * dropped, so a slow response of the previous order or filter never lands in
 * the new list, and paging never mixes two of them.
 *
 * Sort and filter send no parameter for their defaults, and degrade without
 * an error when the index cannot honour them: its plain list is already
 * everyone's, newest first, so the hook keeps it (never filtering it
 * client-side), reports the feature unsupported and stops sending the
 * parameter. For the filters that is remembered for the browser session, so
 * the chips stay hidden on the next page. A sorted request that fails goes
 * back to newest with a toast, and a filtered one back to everyone with a
 * toast; an index that refuses a filter with 400 is reported through
 * `filterRejected` and keeps the filter chosen, so the reason is shown
 * instead of a silent fallback.
 */
export function useMarketplaceReviews(target: MarketplaceReviewsTarget): MarketplaceReviewsState {
  const { sellerPubky, listingId } = target;
  const targetKey = `${sellerPubky}:${listingId ?? ''}`;
  const viewerPubky = useAuthStore((state) => state.currentUserPubky);
  const [chosen, setChosen] = useState<{
    targetKey: string;
    sort: MarketplaceReviewSort;
    filter: MarketplaceReviewFilter;
  }>({
    targetKey,
    sort: MARKETPLACE_REVIEW_SORT_DEFAULT,
    filter: MARKETPLACE_REVIEW_FILTER_DEFAULT,
  });
  const isChosenTarget = chosen.targetKey === targetKey;
  const sort = isChosenTarget ? chosen.sort : MARKETPLACE_REVIEW_SORT_DEFAULT;
  const chosenFilter = isChosenTarget ? chosen.filter : MARKETPLACE_REVIEW_FILTER_DEFAULT;
  const keyWindowsVersion = useAttestorKeyWindowsVersion();
  // A filtered page and its `matched` are counted against the attestor windows sent with the request, so a
  // filtered list reloads when they change; the unfiltered list sends none and keeps its pages.
  const filteredWindowsVersion =
    reviewFilterRequest(chosenFilter, viewerPubky) === undefined ? null : keyWindowsVersion;
  const [sortSupported, setSortSupported] = useState(true);
  const [filtersUnsupported, setFiltersUnsupported] = useState(reviewFiltersKnownUnsupported);
  // Mirrors `filtersUnsupported` for the fetch effect, which must not restart when the answer flips.
  const filtersUnsupportedRef = useRef(filtersUnsupported);
  const [reviews, setReviews] = useState<CommerceIndexedReview[]>([]);
  const [matched, setMatched] = useState<CommerceReviewMatch | null | undefined>(undefined);
  const [filterRejected, setFilterRejected] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [isFetching, setIsFetching] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextSkip, setNextSkip] = useState(0);
  const epochRef = useRef(0);
  const loadedTargetRef = useRef<string | null>(null);
  const filtersAvailable = viewerPubky !== null && !filtersUnsupported;
  const filter = filtersAvailable ? chosenFilter : MARKETPLACE_REVIEW_FILTER_DEFAULT;

  useEffect(() => {
    const epoch = ++epochRef.current;
    const isCurrent = () => epochRef.current === epoch;
    const isNewTarget = loadedTargetRef.current !== targetKey;
    const request = filtersUnsupportedRef.current ? undefined : reviewFilterRequest(chosenFilter, viewerPubky);
    if (isNewTarget) setStatus('loading');
    setReviews([]);
    setMatched(undefined);
    setFilterRejected(false);
    setHasMore(false);
    setNextSkip(0);
    setIsFetching(true);
    setIsReordering(!isNewTarget);
    fetchReviewsPage({ sellerPubky, listingId }, 0, sort, request)
      .then((result) => {
        if (!isCurrent()) return;
        if (result.status === 'rejected') {
          loadedTargetRef.current = targetKey;
          setMatched(null);
          setFilterRejected(true);
          setStatus('ok');
          return;
        }
        if (result.status === 'unavailable') {
          if (request !== undefined) {
            toast({ variant: 'error', description: REVIEW_FILTER_COPY.failed });
            setChosen({ targetKey, sort, filter: MARKETPLACE_REVIEW_FILTER_DEFAULT });
            return;
          }
          if (sort === MARKETPLACE_REVIEW_SORT_DEFAULT) {
            setStatus('unavailable');
            return;
          }
          toast({ variant: 'error', description: REVIEW_SORT_COPY.failed });
          setChosen({ targetKey, sort: MARKETPLACE_REVIEW_SORT_DEFAULT, filter: chosenFilter });
          return;
        }
        if (sort !== MARKETPLACE_REVIEW_SORT_DEFAULT && !result.sortApplied) setSortSupported(false);
        if (request !== undefined && !result.filterApplied) {
          filtersUnsupportedRef.current = true;
          rememberReviewFiltersUnsupported();
          setFiltersUnsupported(true);
        }
        loadedTargetRef.current = targetKey;
        setReviews(result.reviews);
        setMatched(result.matched);
        setNextSkip(result.reviews.length);
        setHasMore(result.reviews.length === MARKETPLACE_REVIEWS_PAGE_SIZE);
        setStatus('ok');
      })
      .finally(() => {
        if (!isCurrent()) return;
        setIsFetching(false);
        setIsReordering(false);
      });
  }, [sellerPubky, listingId, targetKey, sort, chosenFilter, viewerPubky, filteredWindowsVersion]);

  const loadMore = () => {
    if (isFetching || status !== 'ok' || filterRejected) return;
    const epoch = epochRef.current;
    const isCurrent = () => epochRef.current === epoch;
    const request = filtersUnsupported ? undefined : reviewFilterRequest(chosenFilter, viewerPubky);
    setIsFetching(true);
    fetchReviewsPage(
      { sellerPubky, listingId },
      nextSkip,
      sortSupported ? sort : MARKETPLACE_REVIEW_SORT_DEFAULT,
      request,
    )
      .then((result) => {
        if (!isCurrent()) return;
        // A later filtered page the index refuses, or answers with its unfiltered list, ends the paging: appending
        // it would mix everyone's reviews into the filtered list.
        if (
          result.status === 'rejected' ||
          (result.status === 'ok' && request !== undefined && !result.filterApplied)
        ) {
          setHasMore(false);
          return;
        }
        if (result.status !== 'ok') return;
        setReviews((current) => {
          const known = new Set(current.map(({ reviewerId, reviewId }) => `${reviewerId}:${reviewId}`));
          const fresh = result.reviews.filter(({ reviewerId, reviewId }) => !known.has(`${reviewerId}:${reviewId}`));
          return [...current, ...fresh];
        });
        setNextSkip(nextSkip + result.reviews.length);
        setHasMore(result.reviews.length === MARKETPLACE_REVIEWS_PAGE_SIZE);
      })
      .finally(() => {
        if (isCurrent()) setIsFetching(false);
      });
  };

  const filterSummary: MarketplaceReviewFilterSummary | null = !isActiveReviewFilter(filter)
    ? null
    : matched === undefined
      ? { state: 'loading', filter }
      : matched === null
        ? { state: 'unscored', filter }
        : { state: 'ready', filter, matched };

  return {
    status,
    reviews,
    isFetching,
    isReordering,
    hasMore,
    loadMore,
    sort: sortSupported ? sort : MARKETPLACE_REVIEW_SORT_DEFAULT,
    setSort: (next) => setChosen({ targetKey, sort: next, filter: chosenFilter }),
    sortSupported,
    filter,
    setFilter: (next) => {
      const normalized = normalizeReviewFilter(next);
      if (reviewFilterKey(normalized) === reviewFilterKey(chosenFilter)) return;
      setChosen({ targetKey, sort, filter: normalized });
    },
    filtersAvailable,
    filterSummary,
    filterRejected,
  };
}
