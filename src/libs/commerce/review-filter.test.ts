import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isActiveReviewFilter,
  MARKETPLACE_REVIEW_FILTER_DEFAULT,
  normalizeReviewFilter,
  normalizeReviewTagLabels,
  rememberReviewFiltersUnsupported,
  reviewFilterKey,
  reviewFilterRequest,
  reviewFiltersKnownUnsupported,
} from './review-filter';

const VIEWER = 'v'.repeat(52);

describe('normalizeReviewTagLabels', () => {
  it('trims, lowercases and de-duplicates the labels, keeping the first of each', () => {
    expect(normalizeReviewTagLabels(['  Trusted ', 'trusted', 'FAST', 'fast '])).toEqual(['trusted', 'fast']);
  });

  it('drops labels a tag cannot carry: empty, too long, or with a separator character', () => {
    expect(normalizeReviewTagLabels(['', '   ', 'a'.repeat(21), 'two words', 'a,b', 'a:b', 'ok'])).toEqual(['ok']);
  });

  it('keeps a label of exactly the length limit', () => {
    expect(normalizeReviewTagLabels(['a'.repeat(20)])).toEqual(['a'.repeat(20)]);
  });

  it('keeps at most the first five labels', () => {
    expect(normalizeReviewTagLabels(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('normalizeReviewFilter', () => {
  it('reads tagged with no usable label as all', () => {
    expect(normalizeReviewFilter({ kind: 'tagged', labels: [] })).toEqual({ kind: 'all' });
    expect(normalizeReviewFilter({ kind: 'tagged', labels: ['two words'] })).toEqual({ kind: 'all' });
  });

  it('normalizes the labels of a tagged filter and leaves the other kinds alone', () => {
    expect(normalizeReviewFilter({ kind: 'tagged', labels: [' Fast ', 'fast'] })).toEqual({
      kind: 'tagged',
      labels: ['fast'],
    });
    expect(normalizeReviewFilter({ kind: 'wot' })).toEqual({ kind: 'wot' });
  });
});

describe('reviewFilterKey and isActiveReviewFilter', () => {
  it('gives equal filters equal keys and different ones different keys', () => {
    const keys = [
      reviewFilterKey({ kind: 'all' }),
      reviewFilterKey({ kind: 'following' }),
      reviewFilterKey({ kind: 'wot' }),
      reviewFilterKey({ kind: 'tagged', labels: ['a', 'b'] }),
      reviewFilterKey({ kind: 'tagged', labels: ['b', 'a'] }),
    ];
    expect(new Set(keys).size).toBe(5);
    expect(reviewFilterKey({ kind: 'tagged', labels: ['a', 'b'] })).toBe(keys[3]);
  });

  it('calls everything but all active', () => {
    expect(isActiveReviewFilter(MARKETPLACE_REVIEW_FILTER_DEFAULT)).toBe(false);
    expect(isActiveReviewFilter({ kind: 'following' })).toBe(true);
    expect(isActiveReviewFilter({ kind: 'tagged', labels: ['a'] })).toBe(true);
  });
});

describe('reviewFilterRequest', () => {
  it('sends nothing for all', () => {
    expect(reviewFilterRequest({ kind: 'all' }, VIEWER)).toBeUndefined();
  });

  it('sends nothing without a viewer, whatever the filter', () => {
    expect(reviewFilterRequest({ kind: 'following' }, null)).toBeUndefined();
    expect(reviewFilterRequest({ kind: 'tagged', labels: ['a'] }, null)).toBeUndefined();
  });

  it('maps each chip to its parameters, My network at depth two', () => {
    expect(reviewFilterRequest({ kind: 'following' }, VIEWER)).toEqual({ viewerId: VIEWER, reach: 'following' });
    expect(reviewFilterRequest({ kind: 'wot' }, VIEWER)).toEqual({ viewerId: VIEWER, reach: 'wot', depth: 2 });
    expect(reviewFilterRequest({ kind: 'tagged', labels: [' Fast ', 'fast', 'slow'] }, VIEWER)).toEqual({
      viewerId: VIEWER,
      taggedLabels: ['fast', 'slow'],
    });
  });
});

describe('session memory of an index that cannot filter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('starts unknown, then remembers for the session', () => {
    expect(reviewFiltersKnownUnsupported()).toBe(false);
    rememberReviewFiltersUnsupported();
    expect(reviewFiltersKnownUnsupported()).toBe(true);
  });

  it('survives storage that throws, reading as not known', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => rememberReviewFiltersUnsupported()).not.toThrow();
    expect(reviewFiltersKnownUnsupported()).toBe(false);
  });
});
