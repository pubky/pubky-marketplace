import {
  marketplaceTrustedAttestors,
  trustedMarketplaceAttestorAt,
  trustedMarketplaceAttestorAtRecordTime,
} from '@/config/commerce';
import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';
import type {
  CommerceIndexedReview,
  CommerceReputationBucket,
  CommerceReputationSnippet,
  CommerceReputationSummary,
} from '@/models/commerce/commerce.schema';

/**
 * Counting rules v2 on the client (reviews design section 2). The index
 * verifies signatures and groups counted reviews into one bucket per
 * attestor; which attestors count, and from when to when, is this client's
 * trust list. Two ways to apply it:
 *
 * - exact: the index computes the figure over the trusted windows
 *   (`attestors=`, see {@link attestorWindowsParam}); storefront and seller
 *   headers use this.
 * - cards: sum the trusted buckets whose window covers the bucket's whole
 *   `[firstIat, lastIat]`, and drop a bucket a window cuts, so a card never
 *   over-counts. Summed buckets count a buyer once per attestor.
 */

/** Most entries the index accepts in one `attestors=` parameter. */
export const MARKETPLACE_ATTESTOR_WINDOWS_MAX = 20;

/** The counted figures one surface displays. */
export interface CountedReputation {
  /** Distinct buyers with a counted review (N). */
  buyers: number;
  /** Distinct attested orders (M). */
  orders: number;
  /** Counted reviews (the histogram's total). */
  reviews: number;
  /** Mean over buyers of each buyer's mean item stars; null without counted buyers. */
  itemRating: number | null;
  /** Buyers with a seller rating (RV2). Zero outside the seller scope. */
  sellerBuyers: number;
  /** Mean over buyers of their mean order seller score (RV2); null without one. */
  sellerRating: number | null;
}

interface TrustInterval {
  fromMs: number;
  untilMs: number;
}

/**
 * Each trusted pubky's windows `[validFrom, validUntil)`, overlapping and
 * touching windows merged, so a bucket inside two back-to-back epochs of one
 * key is not treated as cut.
 */
function trustIntervals(entries: readonly MarketplaceTrustedAttestor[]): Map<string, TrustInterval[]> {
  const byPubky = new Map<string, TrustInterval[]>();
  for (const entry of entries) {
    const fromMs = Date.parse(entry.validFrom);
    const untilMs = entry.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(entry.validUntil);
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs) || untilMs <= fromMs) continue;
    byPubky.set(entry.pubky, [...(byPubky.get(entry.pubky) ?? []), { fromMs, untilMs }]);
  }
  for (const [pubky, intervals] of byPubky) {
    const merged: TrustInterval[] = [];
    for (const interval of [...intervals].sort((a, b) => a.fromMs - b.fromMs)) {
      const last = merged.at(-1);
      if (last !== undefined && interval.fromMs <= last.untilMs) {
        last.untilMs = Math.max(last.untilMs, interval.untilMs);
      } else {
        merged.push({ ...interval });
      }
    }
    byPubky.set(pubky, merged);
  }
  return byPubky;
}

/**
 * The `attestors=` value for the effective trust list:
 * `<pubky>:<from>:<until>` per window, in whole seconds over the attestation
 * `iat` (an open `validUntil` leaves `until` empty). The bounds round up, so
 * an integer `iat` is inside exactly when `validFrom <= iat < validUntil`.
 *
 * Null when there is nothing to send: no trusted windows (the index answers
 * an empty value with a 400) or more than the index accepts. Callers then
 * fall back to the per-attestor buckets, which never over-count.
 */
export function attestorWindowsParam(
  entries: readonly MarketplaceTrustedAttestor[] = marketplaceTrustedAttestors(),
): string | null {
  const windows: string[] = [];
  for (const [pubky, intervals] of trustIntervals(entries)) {
    for (const { fromMs, untilMs } of intervals) {
      const from = Math.ceil(fromMs / 1000);
      const until = Number.isFinite(untilMs) ? Math.ceil(untilMs / 1000) : null;
      if (until !== null && until <= from) continue;
      windows.push(`${pubky}:${from}:${until ?? ''}`);
    }
  }
  if (windows.length === 0 || windows.length > MARKETPLACE_ATTESTOR_WINDOWS_MAX) return null;
  return windows.join(',');
}

/**
 * Whether one trust window covers the bucket's whole `[firstIat, lastIat]`.
 * A bucket with nothing counted (null bounds) is covered by nothing.
 */
function bucketCovered(bucket: CommerceReputationBucket, intervals: readonly TrustInterval[] | undefined): boolean {
  if (intervals === undefined || bucket.firstIat === null || bucket.lastIat === null) return false;
  const firstMs = bucket.firstIat * 1000;
  const lastMs = bucket.lastIat * 1000;
  return intervals.some(({ fromMs, untilMs }) => fromMs <= firstMs && lastMs < untilMs);
}

/** Display figures from one bucket's sums. */
export function countedFromBucket(bucket: CommerceReputationBucket): CountedReputation {
  return countedFromBuckets([bucket]);
}

function countedFromBuckets(buckets: readonly CommerceReputationBucket[]): CountedReputation {
  let buyers = 0;
  let orders = 0;
  let reviews = 0;
  let sumBuyerMeans = 0;
  let sellerBuyers = 0;
  let sumSellerBuyerMeans = 0;
  for (const bucket of buckets) {
    buyers += bucket.buyers;
    orders += bucket.orders;
    reviews += bucket.histogram.reduce((total, count) => total + count, 0);
    sumBuyerMeans += bucket.sumBuyerMeans;
    sellerBuyers += bucket.sellerBuyers ?? 0;
    sumSellerBuyerMeans += bucket.sumSellerBuyerMeans ?? 0;
  }
  return {
    buyers,
    orders,
    reviews,
    itemRating: buyers > 0 ? sumBuyerMeans / buyers : null,
    sellerBuyers,
    sellerRating: sellerBuyers > 0 ? sumSellerBuyerMeans / sellerBuyers : null,
  };
}

/**
 * The card rule: the sum of the trusted attestors' buckets that a single
 * trust window covers whole. A bucket from an untrusted attestor, or one a
 * window cuts (some of its reviews fall outside), adds nothing.
 */
export function countedFromTrustedBuckets(
  buckets: Record<string, CommerceReputationBucket>,
  entries: readonly MarketplaceTrustedAttestor[] = marketplaceTrustedAttestors(),
): CountedReputation {
  const intervals = trustIntervals(entries);
  return countedFromBuckets(
    Object.entries(buckets)
      .filter(([attestorId, bucket]) => bucketCovered(bucket, intervals.get(attestorId)))
      .map(([, bucket]) => bucket),
  );
}

/**
 * A card's counted figures, or null when the snippet comes from an index
 * without trust buckets (the caller keeps today's display and claims no
 * counted figure).
 */
export function countedSnippetReputation(snippet: CommerceReputationSnippet): CountedReputation | null {
  return snippet.buckets === undefined ? null : countedFromTrustedBuckets(snippet.buckets);
}

/**
 * A full aggregate's counted figures: the index's exact figure over the
 * trusted windows when it served one, else the card rule over its buckets.
 * Null when the index serves no buckets at all.
 */
export function countedSummaryReputation(summary: CommerceReputationSummary): CountedReputation | null {
  if (summary.scoped !== undefined) return countedFromBucket(summary.scoped);
  return summary.buckets === undefined ? null : countedFromTrustedBuckets(summary.buckets);
}

/**
 * The trust-list entry that vouches for one indexed review. The window is
 * checked against the attestation's `iat` when the index serves it; an
 * entry without `iat` (an index before IX2, or one not yet backfilled)
 * falls back to the fail-closed record-time check.
 */
export function indexedReviewTrustedAttestor(review: CommerceIndexedReview): MarketplaceTrustedAttestor | null {
  if (!review.verified) return null;
  if (typeof review.iat === 'number')
    return trustedMarketplaceAttestorAt(review.attestorId, new Date(review.iat * 1000));
  return trustedMarketplaceAttestorAtRecordTime(review.attestorId, new Date(review.createdAt));
}

/**
 * Whether a listed review is one of the counted ones: verified by an
 * attestor trusted at its attestation time and not excluded by moderation
 * (hidden text still counts).
 */
export function isCountedIndexedReview(review: CommerceIndexedReview): boolean {
  return review.moderation?.state !== 'excluded' && indexedReviewTrustedAttestor(review) !== null;
}

/** "3 buyers · 4 orders": the basis of a per-buyer mean. */
export function formatCountedBasis({ buyers, orders }: { buyers: number; orders: number }, separator = ' · '): string {
  return `${buyers} ${buyers === 1 ? 'buyer' : 'buyers'}${separator}${orders} ${orders === 1 ? 'order' : 'orders'}`;
}
