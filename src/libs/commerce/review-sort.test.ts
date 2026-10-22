import { describe, expect, it } from 'vitest';
import { REVIEW_SORT_COPY } from '@/config/commerce-copy';
import {
  isMarketplaceReviewSort,
  MARKETPLACE_REVIEW_SORT_DEFAULT,
  MARKETPLACE_REVIEW_SORTS,
  reviewSortParam,
} from './review-sort';

describe('reviewSortParam', () => {
  it('sends no parameter for the default order, so the index answers its bare list', () => {
    expect(MARKETPLACE_REVIEW_SORT_DEFAULT).toBe('newest');
    expect(reviewSortParam('newest')).toBeUndefined();
  });

  it.each([
    ['value', 'value'],
    ['rating_desc', 'rating_desc'],
    ['rating_asc', 'rating_asc'],
  ] as const)('maps %s to the index parameter %s', (sort, param) => {
    expect(reviewSortParam(sort)).toBe(param);
  });
});

describe('review sort options', () => {
  it('lists Newest first, then the three other orders, each with its label', () => {
    expect(MARKETPLACE_REVIEW_SORTS.map((sort) => REVIEW_SORT_COPY.options[sort])).toEqual([
      'Newest',
      'Highest-value purchases',
      'Highest rated',
      'Lowest rated',
    ]);
  });

  it('recognises only the four orders', () => {
    expect(MARKETPLACE_REVIEW_SORTS.every(isMarketplaceReviewSort)).toBe(true);
    expect(isMarketplaceReviewSort('oldest')).toBe(false);
    expect(isMarketplaceReviewSort('')).toBe(false);
  });
});
