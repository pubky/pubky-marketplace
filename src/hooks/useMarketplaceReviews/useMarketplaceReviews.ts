'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CommerceIndexedReviewsResult, CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';
import { REVIEW_SORT_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAttestorKeyWindowsVersion } from '@/hooks/useAttestorKeyWindows/useAttestorKeyWindows';
import { countedSnippetReputation } from '@/libs/commerce/review-counting';
import {
  MARKETPLACE_REVIEW_SORT_DEFAULT,
  type MarketplaceReviewSort,
  reviewSortParam,
} from '@/libs/commerce/review-sort';
import type { CommerceIndexedReview, CommerceReputationSnippet } from '@/models/commerce/commerce.schema';
import { toast } from '@/molecules/Toaster/use-toast';

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
}

async function fetchReviewsPage(
  { sellerPubky, listingId }: MarketplaceReviewsTarget,
  skip: number,
  sort: MarketplaceReviewSort,
): Promise<CommerceIndexedReviewsResult> {
  const page = { skip, limit: MARKETPLACE_REVIEWS_PAGE_SIZE, sort: reviewSortParam(sort) };
  return listingId === undefined
    ? await CommerceController.fetchSellerReviews(sellerPubky, page)
    : await CommerceController.fetchListingReviews(sellerPubky, listingId, page);
}

/**
 * Paged review list for a seller or one listing, newest-indexed first unless
 * a sort is chosen. `unavailable` means no review index serves this
 * deployment — the caller renders no review section rather than an empty one.
 *
 * Every request belongs to one epoch, which any change of target or sort
 * ends: a page that answers after its epoch ended is dropped, so a slow
 * response of the previous order never lands in the new list, and paging
 * never mixes two orders. The sort sends no parameter for the default and
 * degrades without an error when the index cannot sort: its plain list is
 * already newest first, so the hook keeps it, reports `sortSupported: false`
 * and stops sending the parameter. A sorted request that fails goes back to
 * newest with a toast.
 */
export function useMarketplaceReviews(target: MarketplaceReviewsTarget): MarketplaceReviewsState {
  const { sellerPubky, listingId } = target;
  const targetKey = `${sellerPubky}:${listingId ?? ''}`;
  const [chosen, setChosen] = useState<{ targetKey: string; sort: MarketplaceReviewSort }>({
    targetKey,
    sort: MARKETPLACE_REVIEW_SORT_DEFAULT,
  });
  const sort = chosen.targetKey === targetKey ? chosen.sort : MARKETPLACE_REVIEW_SORT_DEFAULT;
  const [sortSupported, setSortSupported] = useState(true);
  const [reviews, setReviews] = useState<CommerceIndexedReview[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [isFetching, setIsFetching] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextSkip, setNextSkip] = useState(0);
  const epochRef = useRef(0);
  const loadedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const epoch = ++epochRef.current;
    const isCurrent = () => epochRef.current === epoch;
    const isNewTarget = loadedTargetRef.current !== targetKey;
    if (isNewTarget) setStatus('loading');
    setReviews([]);
    setHasMore(false);
    setNextSkip(0);
    setIsFetching(true);
    setIsReordering(!isNewTarget);
    fetchReviewsPage({ sellerPubky, listingId }, 0, sort)
      .then((result) => {
        if (!isCurrent()) return;
        if (result.status === 'unavailable') {
          if (sort === MARKETPLACE_REVIEW_SORT_DEFAULT) {
            setStatus('unavailable');
            return;
          }
          toast({ variant: 'error', description: REVIEW_SORT_COPY.failed });
          setChosen({ targetKey, sort: MARKETPLACE_REVIEW_SORT_DEFAULT });
          return;
        }
        if (sort !== MARKETPLACE_REVIEW_SORT_DEFAULT && !result.sortApplied) setSortSupported(false);
        loadedTargetRef.current = targetKey;
        setReviews(result.reviews);
        setNextSkip(result.reviews.length);
        setHasMore(result.reviews.length === MARKETPLACE_REVIEWS_PAGE_SIZE);
        setStatus('ok');
      })
      .finally(() => {
        if (!isCurrent()) return;
        setIsFetching(false);
        setIsReordering(false);
      });
  }, [sellerPubky, listingId, targetKey, sort]);

  const loadMore = () => {
    if (isFetching || status !== 'ok') return;
    const epoch = epochRef.current;
    const isCurrent = () => epochRef.current === epoch;
    setIsFetching(true);
    fetchReviewsPage({ sellerPubky, listingId }, nextSkip, sortSupported ? sort : MARKETPLACE_REVIEW_SORT_DEFAULT)
      .then((result) => {
        if (!isCurrent() || result.status !== 'ok') return;
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

  return {
    status,
    reviews,
    isFetching,
    isReordering,
    hasMore,
    loadMore,
    sort: sortSupported ? sort : MARKETPLACE_REVIEW_SORT_DEFAULT,
    setSort: (next) => setChosen({ targetKey, sort: next }),
    sortSupported,
  };
}
