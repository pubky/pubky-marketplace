import type { NexusReviewSort } from '@/services/nexus/marketplace/marketplace.types';

/** The orders a review list offers (reviews design section 3). */
export type MarketplaceReviewSort = NexusReviewSort;

/** A sort the index is told about: every order but the default. */
export type MarketplaceReviewSortParam = Exclude<MarketplaceReviewSort, 'newest'>;

export const MARKETPLACE_REVIEW_SORTS = ['newest', 'value', 'rating_desc', 'rating_asc'] as const satisfies readonly [
  MarketplaceReviewSort,
  ...MarketplaceReviewSort[],
];

export const MARKETPLACE_REVIEW_SORT_DEFAULT = 'newest' satisfies MarketplaceReviewSort;

export function isMarketplaceReviewSort(value: string): value is MarketplaceReviewSort {
  return (MARKETPLACE_REVIEW_SORTS as readonly string[]).includes(value);
}

/**
 * The `sort` query parameter for a list order. The default sends none: the
 * index's own order is newest indexed first, and a request without the
 * parameter keeps the bare-list answer every index serves.
 */
export function reviewSortParam(sort: MarketplaceReviewSort): MarketplaceReviewSortParam | undefined {
  return sort === 'newest' ? undefined : sort;
}
