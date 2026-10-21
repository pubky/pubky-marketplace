import { describe, expect, it } from 'vitest';
import { COMMERCE_REVIEW_EDIT_WINDOW_SECONDS } from '@/config/commerce';
import {
  buyerSellerRatings,
  listingIdFromAggregate,
  orderReviewListings,
  type OrderReviewSource,
  reviewListingAggregateId,
  reviewsOfReviewer,
  reviewWindowClosesAtMs,
  unreviewedListings,
} from './order-reviews';

const BUYER = 'b'.repeat(52);
const SELLER = 's'.repeat(52);
const aggregate = (id: string) => `listing:${SELLER}_${id}`;

const order = (reviews: OrderReviewSource['reviews'] = []): OrderReviewSource => ({
  buyerPubky: BUYER,
  sellerPubky: SELLER,
  lines: [
    { listingAggregateId: aggregate('boots'), title: 'Boots' },
    { listingAggregateId: aggregate('belt'), title: 'Belt' },
    { listingAggregateId: aggregate('boots'), title: 'Boots again' },
    { listingAggregateId: `listing:${'x'.repeat(52)}_foreign`, title: 'Foreign' },
  ],
  reviews,
});

const review = (
  id: string | undefined,
  overrides: Partial<NonNullable<OrderReviewSource['reviews']>[number]> = {},
) => ({
  reviewerPubky: BUYER,
  ...(id === undefined ? {} : { listingAggregateId: aggregate(id) }),
  rating: 5,
  text: '',
  createdAt: '2026-08-21T10:00:00.000Z',
  ...overrides,
});

describe('order review helpers', () => {
  it('reads the seller record id out of a listing aggregate id', () => {
    expect(listingIdFromAggregate(SELLER, aggregate('boots'))).toBe('boots');
    expect(listingIdFromAggregate(SELLER, `listing:${'x'.repeat(52)}_boots`)).toBeNull();
    expect(listingIdFromAggregate(SELLER, `listing:${SELLER}_`)).toBeNull();
  });

  it('lists the distinct reviewable listings in line order, titled by their first line', () => {
    expect(orderReviewListings(order())).toEqual([
      { listingAggregateId: aggregate('boots'), listingId: 'boots', title: 'Boots' },
      { listingAggregateId: aggregate('belt'), listingId: 'belt', title: 'Belt' },
    ]);
  });

  it('attributes a review without a listing to the first line', () => {
    expect(reviewListingAggregateId(order(), review(undefined))).toBe(aggregate('boots'));
    expect(reviewListingAggregateId(order(), review('belt'))).toBe(aggregate('belt'));
  });

  it('keeps the listings the buyer has not reviewed yet', () => {
    expect(unreviewedListings(order()).map(({ listingId }) => listingId)).toEqual(['boots', 'belt']);
    expect(unreviewedListings(order([review('boots')])).map(({ listingId }) => listingId)).toEqual(['belt']);
    expect(unreviewedListings(order([review(undefined)])).map(({ listingId }) => listingId)).toEqual(['belt']);
    expect(unreviewedListings(order([review('boots'), review('belt')]))).toEqual([]);
  });

  it('ignores the seller reviews of the buyer', () => {
    const reviews = [review('boots'), review(undefined, { reviewerPubky: SELLER })];

    expect(reviewsOfReviewer(order(reviews), BUYER)).toHaveLength(1);
    expect(unreviewedListings(order([review(undefined, { reviewerPubky: SELLER })]))).toHaveLength(2);
  });

  it('reads the buyer seller ratings from any item review that has both', () => {
    expect(buyerSellerRatings(order([review('boots'), review('belt')]))).toBeNull();
    expect(buyerSellerRatings(order([review('boots', { shipping: 4 })]))).toBeNull();
    expect(buyerSellerRatings(order([review('boots'), review('belt', { shipping: 4, communication: 3 })]))).toEqual({
      shipping: 4,
      communication: 3,
    });
  });

  it('closes the window 24 hours after the earliest review', () => {
    const early = Date.parse('2026-08-21T10:00:00.000Z');

    expect(reviewWindowClosesAtMs([])).toBeNull();
    expect(
      reviewWindowClosesAtMs([{ createdAt: '2026-08-21T12:00:00.000Z' }, { createdAt: '2026-08-21T10:00:00.000Z' }]),
    ).toBe(early + COMMERCE_REVIEW_EDIT_WINDOW_SECONDS * 1000);
  });
});
