import { COMMERCE_REVIEW_EDIT_WINDOW_SECONDS } from '@/config/commerce';

/** The slice of an order the review helpers read: its parties, lines and the service's review views. */
export type OrderReviewSource = {
  buyerPubky: string;
  sellerPubky: string;
  lines: { listingAggregateId: string; title: string }[];
  reviews?:
    | {
        reviewerPubky: string;
        listingAggregateId?: string;
        rating: number;
        text: string;
        shipping?: number | null;
        communication?: number | null;
        createdAt: string;
      }[]
    | null;
};

export type OrderReviewListing = {
  listingAggregateId: string;
  /** The seller's record id: the part after `listing:{seller}_` in the aggregate id. */
  listingId: string;
  title: string;
};

export type OrderItemReview = NonNullable<OrderReviewSource['reviews']>[number];

/** The seller's record id of a listing aggregate id, or null when the id is not the seller's. */
export function listingIdFromAggregate(sellerPubky: string, listingAggregateId: string): string | null {
  const prefix = `listing:${sellerPubky}_`;
  if (!listingAggregateId.startsWith(prefix)) return null;
  const listingId = listingAggregateId.slice(prefix.length);
  return listingId.length > 0 ? listingId : null;
}

/**
 * The order's distinct listings in line order, each titled by its first
 * line: the units a buyer reviews one by one. A line whose aggregate id is
 * not the seller's carries no reviewable identity and is left out.
 */
export function orderReviewListings(order: Pick<OrderReviewSource, 'sellerPubky' | 'lines'>): OrderReviewListing[] {
  const listings: OrderReviewListing[] = [];
  for (const line of order.lines) {
    if (listings.some(({ listingAggregateId }) => listingAggregateId === line.listingAggregateId)) continue;
    const listingId = listingIdFromAggregate(order.sellerPubky, line.listingAggregateId);
    if (listingId === null) continue;
    listings.push({ listingAggregateId: line.listingAggregateId, listingId, title: line.title });
  }
  return listings;
}

/** One reviewer's reviews of the order. */
export function reviewsOfReviewer(order: OrderReviewSource, reviewerPubky: string): OrderItemReview[] {
  return (order.reviews ?? []).filter((review) => review.reviewerPubky === reviewerPubky);
}

/**
 * The listing a review rates. Reviews read from a service without per-item
 * reviews carry no listing and rate the order's first line, as the service
 * keys them.
 */
export function reviewListingAggregateId(order: OrderReviewSource, review: OrderItemReview): string | null {
  return review.listingAggregateId ?? order.lines[0]?.listingAggregateId ?? null;
}

/** The order's listings the buyer has not reviewed yet. */
export function unreviewedListings(order: OrderReviewSource): OrderReviewListing[] {
  const reviewed = new Set(
    reviewsOfReviewer(order, order.buyerPubky).map((review) => reviewListingAggregateId(order, review)),
  );
  return orderReviewListings(order).filter(({ listingAggregateId }) => !reviewed.has(listingAggregateId));
}

/** The buyer's seller ratings, written identically on every item review; null when unrated. */
export function buyerSellerRatings(order: OrderReviewSource): { shipping: number; communication: number } | null {
  for (const review of reviewsOfReviewer(order, order.buyerPubky)) {
    if (review.shipping != null && review.communication != null) {
      return { shipping: review.shipping, communication: review.communication };
    }
  }
  return null;
}

/**
 * When the reviewer's edit window closes: the service counts it from their
 * first review of the order and refuses adding and editing once it passes.
 * Null when they have not reviewed.
 */
export function reviewWindowClosesAtMs(reviews: Pick<OrderItemReview, 'createdAt'>[]): number | null {
  if (reviews.length === 0) return null;
  const opened = Math.min(...reviews.map(({ createdAt }) => Date.parse(createdAt)));
  return opened + COMMERCE_REVIEW_EDIT_WINDOW_SECONDS * 1000;
}
