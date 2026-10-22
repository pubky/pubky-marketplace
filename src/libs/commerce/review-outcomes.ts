import { type ReviewOutcome, reviewOutcomeKey } from '@/libs/commerce/attestor-records';
import { indexedReviewTrustedAttestor } from '@/libs/commerce/review-counting';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';

/**
 * The attested order whose annotation can say a review's order was refunded
 * or returned: the review's `order_ref` under its attestor, and only while
 * that attestor is trusted for the review (verified, inside its trust
 * window). An attestor this client does not trust, or has narrowed away,
 * gets no say about the review, and neither does an unattested review.
 */
export function reviewOutcomeOrder(review: CommerceIndexedReview): { attestorId: string; orderRef: string } | null {
  const orderRef = review.orderRef;
  if (typeof orderRef !== 'string' || review.attestorId === null) return null;
  return indexedReviewTrustedAttestor(review) === null ? null : { attestorId: review.attestorId, orderRef };
}

/** The outcomes to show next to a review: its order's, from the fetched annotations; empty for none. */
export function reviewOutcomesOf(
  review: CommerceIndexedReview,
  outcomes: ReadonlyMap<string, ReviewOutcome[]>,
): ReviewOutcome[] {
  const order = reviewOutcomeOrder(review);
  return order === null ? [] : (outcomes.get(reviewOutcomeKey(order.attestorId, order.orderRef)) ?? []);
}
