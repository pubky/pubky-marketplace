import { describe, expect, it } from 'vitest';
import { MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS } from '@/config/commerce';
import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';
import type {
  CommerceIndexedReview,
  CommerceReputationBucket,
  CommerceReputationSummary,
} from '@/models/commerce/commerce.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import {
  attestorWindowsParam,
  countedFromTrustedBuckets,
  countedSnippetReputation,
  countedSummaryReputation,
  formatCountedBasis,
  indexedReviewTrustedAttestor,
  isCountedIndexedReview,
} from './review-counting';

const A = 'a'.repeat(52);
const B = 'b'.repeat(52);
const UNTRUSTED = 'x'.repeat(52);

const seconds = (iso: string) => Date.parse(iso) / 1000;

function bucket(overrides: Partial<CommerceReputationBucket> = {}): CommerceReputationBucket {
  return {
    orders: 3,
    buyers: 2,
    sumBuyerMeans: 9,
    weightedSum: 9,
    weightTotal: 2,
    histogram: [0, 0, 0, 1, 2],
    firstIat: seconds('2026-03-01T00:00:00Z'),
    lastIat: seconds('2026-06-01T00:00:00Z'),
    sellerBuyers: null,
    sumSellerBuyerMeans: null,
    ...overrides,
  };
}

function entry(pubky: string, validFrom: string, validUntil?: string): MarketplaceTrustedAttestor {
  return { pubky, label: 'Pubky Market', validFrom, ...(validUntil !== undefined && { validUntil }) };
}

function summary(overrides: Partial<CommerceReputationSummary> = {}): CommerceReputationSummary {
  return {
    count: 4,
    verifiedCount: 3,
    avg: 4.25,
    histogram: [0, 0, 0, 3, 1],
    responseCount: 0,
    editedLateCount: 0,
    attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 3 },
    lastReviewedAt: null,
    ...overrides,
  };
}

describe('attestorWindowsParam', () => {
  it('sends each window in whole seconds, rounding a fractional bound up', () => {
    expect(
      attestorWindowsParam([
        entry(A, '2026-01-01T00:00:00Z', '2026-07-01T00:00:00.500Z'),
        entry(B, '2026-02-01T00:00:00.250Z'),
      ]),
    ).toBe(
      `${A}:${seconds('2026-01-01T00:00:00Z')}:${seconds('2026-07-01T00:00:01Z')},${B}:${seconds('2026-02-01T00:00:01Z')}:`,
    );
  });

  it('merges touching and overlapping windows of one key', () => {
    expect(
      attestorWindowsParam([
        entry(A, '2026-04-01T00:00:00Z', '2026-07-01T00:00:00Z'),
        entry(A, '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
        entry(A, '2026-06-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      ]),
    ).toBe(`${A}:${seconds('2026-01-01T00:00:00Z')}:${seconds('2026-08-01T00:00:00Z')}`);
  });

  it('sends nothing for an empty trust list, which the index would refuse', () => {
    expect(attestorWindowsParam([])).toBeNull();
  });

  it('drops a window holding no whole second', () => {
    expect(attestorWindowsParam([entry(A, '2026-01-01T00:00:00.100Z', '2026-01-01T00:00:00.900Z')])).toBeNull();
  });

  it('sends nothing past the 20-window limit, so callers fall back to buckets', () => {
    const many = Array.from({ length: 21 }, (_, index) =>
      entry(
        A,
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
      ),
    );
    expect(attestorWindowsParam(many.slice(0, 20))?.split(',')).toHaveLength(20);
    expect(attestorWindowsParam(many)).toBeNull();
  });

  it('defaults to the effective trust list', () => {
    const [production] = MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS;
    expect(attestorWindowsParam()).toBe(
      `${production.pubky}:${seconds(production.validFrom)}:,${TEST_TRUSTED_ATTESTOR.pubky}:${seconds(TEST_TRUSTED_ATTESTOR.validFrom)}:`,
    );
  });
});

describe('price-weighted item rating', () => {
  const entries = [entry(A, '2026-01-01T00:00:00Z'), entry(B, '2026-01-01T00:00:00Z')];

  it('is weightedSum over weightTotal when some buyer weighs above 1', () => {
    // Buyer one rates 5 at weight 4, buyer two rates 4 at weight 1: (20 + 4) / 5.
    const weighted = bucket({ buyers: 2, sumBuyerMeans: 9, weightedSum: 24, weightTotal: 5 });

    const counted = countedFromTrustedBuckets({ [A]: weighted }, entries);

    expect(counted.itemRating).toBe(4.5);
    expect(counted.weightedItemRating).toBeCloseTo(4.8, 10);
  });

  it('adds the sums of the trusted buckets, never averaging their averages', () => {
    const one = bucket({ buyers: 1, sumBuyerMeans: 5, weightedSum: 20, weightTotal: 4 });
    const two = bucket({ buyers: 1, sumBuyerMeans: 4, weightedSum: 4, weightTotal: 1 });

    const counted = countedFromTrustedBuckets({ [A]: one, [B]: two }, entries);

    expect(counted.weightedItemRating).toBeCloseTo(4.8, 10);
  });

  it('leaves out the bucket of an attestor this client does not trust', () => {
    const heavy = bucket({ buyers: 1, sumBuyerMeans: 1, weightedSum: 5, weightTotal: 5 });
    const light = bucket({ buyers: 1, sumBuyerMeans: 5, weightedSum: 5, weightTotal: 1 });

    const counted = countedFromTrustedBuckets({ [UNTRUSTED]: heavy, [A]: light }, entries);

    expect(counted.weightedItemRating).toBeNull();
  });

  it('is null when every buyer weighs 1: reviews without a price_decade carry no purchase value', () => {
    const counted = countedFromTrustedBuckets({ [A]: bucket({ buyers: 2, weightedSum: 9, weightTotal: 2 }) }, entries);

    expect(counted.itemRating).toBe(4.5);
    expect(counted.weightedItemRating).toBeNull();
  });

  it('is null without counted buyers', () => {
    expect(countedFromTrustedBuckets({}, entries).weightedItemRating).toBeNull();
  });

  it('reads the exact figure of a scoped read', () => {
    const scoped = bucket({ buyers: 2, sumBuyerMeans: 9, weightedSum: 24, weightTotal: 5 });

    expect(countedSummaryReputation(summary({ scoped }))?.weightedItemRating).toBeCloseTo(4.8, 10);
  });
});

describe('countedFromTrustedBuckets (card rule)', () => {
  it('counts a trusted bucket its window covers whole', () => {
    expect(countedFromTrustedBuckets({ [A]: bucket() }, [entry(A, '2026-01-01T00:00:00Z')])).toEqual({
      buyers: 2,
      orders: 3,
      reviews: 3,
      itemRating: 4.5,
      weightedItemRating: null,
      sellerBuyers: 0,
      sellerRating: null,
    });
  });

  it('drops a bucket a window cuts, so a card never over-counts', () => {
    const cutAtEnd = [entry(A, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')];
    const cutAtStart = [entry(A, '2026-04-01T00:00:00Z')];
    expect(countedFromTrustedBuckets({ [A]: bucket() }, cutAtEnd).buyers).toBe(0);
    expect(countedFromTrustedBuckets({ [A]: bucket() }, cutAtStart).buyers).toBe(0);
  });

  it('treats the window end as exclusive', () => {
    const lastIat = seconds('2026-06-01T00:00:00Z');
    expect(
      countedFromTrustedBuckets({ [A]: bucket({ lastIat }) }, [
        entry(A, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      ]).buyers,
    ).toBe(0);
    expect(
      countedFromTrustedBuckets({ [A]: bucket({ lastIat }) }, [
        entry(A, '2026-01-01T00:00:00Z', '2026-06-01T00:00:01Z'),
      ]).buyers,
    ).toBe(2);
  });

  it('keeps a bucket spanning two back-to-back epochs of one key', () => {
    const epochs = [
      entry(A, '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      entry(A, '2026-04-01T00:00:00Z', '2026-12-01T00:00:00Z'),
    ];
    expect(countedFromTrustedBuckets({ [A]: bucket() }, epochs).buyers).toBe(2);
  });

  it('adds two trusted attestors and leaves out an untrusted one', () => {
    const counted = countedFromTrustedBuckets(
      {
        [A]: bucket(),
        [B]: bucket({ orders: 1, buyers: 1, sumBuyerMeans: 3, histogram: [0, 0, 1, 0, 0] }),
        [UNTRUSTED]: bucket({ orders: 9, buyers: 9, sumBuyerMeans: 9, histogram: [9, 0, 0, 0, 0] }),
      },
      [entry(A, '2026-01-01T00:00:00Z'), entry(B, '2026-01-01T00:00:00Z')],
    );
    expect(counted).toMatchObject({ buyers: 3, orders: 4, reviews: 4, itemRating: 4 });
  });

  it('has no rating when no attestor is trusted', () => {
    expect(countedFromTrustedBuckets({ [UNTRUSTED]: bucket() }, [entry(A, '2026-01-01T00:00:00Z')])).toMatchObject({
      buyers: 0,
      itemRating: null,
    });
  });

  it('ignores a bucket with nothing counted', () => {
    expect(
      countedFromTrustedBuckets({ [A]: bucket({ buyers: 0, orders: 0, firstIat: null, lastIat: null }) }, [
        entry(A, '2026-01-01T00:00:00Z'),
      ]).buyers,
    ).toBe(0);
  });

  it('sums the RV2 seller score of seller-scope buckets', () => {
    const counted = countedFromTrustedBuckets(
      {
        [A]: bucket({ sellerBuyers: 2, sumSellerBuyerMeans: 9 }),
        [B]: bucket({ sellerBuyers: 1, sumSellerBuyerMeans: 3.5 }),
      },
      [entry(A, '2026-01-01T00:00:00Z'), entry(B, '2026-01-01T00:00:00Z')],
    );
    expect(counted.sellerBuyers).toBe(3);
    expect(counted.sellerRating).toBeCloseTo(12.5 / 3);
  });
});

describe('countedSnippetReputation and countedSummaryReputation', () => {
  it('claims no counted figure for an index without buckets', () => {
    expect(countedSnippetReputation({ avg: 4.5, count: 2, verifiedCount: 2 })).toBeNull();
    expect(countedSummaryReputation(summary())).toBeNull();
  });

  it('uses the effective trust list on snippet buckets', () => {
    expect(
      countedSnippetReputation({
        avg: 3,
        count: 5,
        verifiedCount: 4,
        buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket(), [UNTRUSTED]: bucket({ buyers: 9 }) },
        unverifiedCount: 1,
      }),
    ).toMatchObject({ buyers: 2, itemRating: 4.5 });
  });

  it("prefers the index's exact scoped figure over summed buckets", () => {
    expect(
      countedSummaryReputation(
        summary({
          buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() },
          scoped: bucket({ buyers: 1, sumBuyerMeans: 5, sellerBuyers: 1, sumSellerBuyerMeans: 4.5 }),
        }),
      ),
    ).toMatchObject({ buyers: 1, itemRating: 5, sellerBuyers: 1, sellerRating: 4.5 });
  });

  it("prefers a listing read's exact scoped figure over the snippet's buckets", () => {
    expect(
      countedSnippetReputation({
        avg: 3,
        count: 5,
        verifiedCount: 4,
        buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() },
        scoped: bucket({ buyers: 1, orders: 1, sumBuyerMeans: 4 }),
      }),
    ).toMatchObject({ buyers: 1, orders: 1, itemRating: 4 });
  });

  it('falls back to the card rule when the index served buckets but no scoped figure', () => {
    expect(countedSummaryReputation(summary({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() } }))).toMatchObject({
      buyers: 2,
      itemRating: 4.5,
    });
  });
});

describe('indexed review trust', () => {
  const review: CommerceIndexedReview = {
    reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
    uri: `pubky://${B}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
    reviewerId: B,
    subjectId: A,
    listingOwnerId: A,
    listingId: 'rangefinder_camera',
    role: 'buyer_reviewing_seller',
    ratingOverall: 5,
    text: '',
    verified: true,
    attestorId: TEST_TRUSTED_ATTESTOR.pubky,
    editedLate: false,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    revision: 1,
    moderation: null,
    response: null,
  };

  it('uses iat when the index serves it', () => {
    expect(indexedReviewTrustedAttestor({ ...review, iat: seconds('2026-03-01T00:00:00Z') })).toEqual(
      TEST_TRUSTED_ATTESTOR,
    );
    // Signed before the window opened, however late the record says it was written.
    expect(indexedReviewTrustedAttestor({ ...review, iat: seconds('2025-12-31T00:00:00Z') })).toBeNull();
  });

  it('falls back to the record time without iat', () => {
    expect(indexedReviewTrustedAttestor(review)).toEqual(TEST_TRUSTED_ATTESTOR);
    expect(indexedReviewTrustedAttestor({ ...review, iat: null, createdAt: '2025-12-31T00:00:00.000Z' })).toBeNull();
  });

  it('never trusts an unverified review', () => {
    expect(indexedReviewTrustedAttestor({ ...review, verified: false, iat: null })).toBeNull();
  });

  it('counts hidden-text reviews and not excluded ones', () => {
    expect(isCountedIndexedReview({ ...review, moderation: { state: 'text_hidden', reason: 'hatespeech' } })).toBe(
      true,
    );
    expect(isCountedIndexedReview({ ...review, moderation: { state: 'excluded', reason: 'review_fraud' } })).toBe(
      false,
    );
  });
});

describe('formatCountedBasis', () => {
  it('pluralizes buyers and orders', () => {
    expect(formatCountedBasis({ buyers: 1, orders: 1 })).toBe('1 buyer · 1 order');
    expect(formatCountedBasis({ buyers: 3, orders: 4 }, ', ')).toBe('3 buyers, 4 orders');
  });
});
