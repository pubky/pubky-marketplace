import { describe, expect, it } from 'vitest';
import {
  aggregateSuffix,
  listingIdFromOrder,
  parseListingAggregateId,
  sellerOfDropAggregateId,
} from './listing-aggregate';

const SELLER = 's'.repeat(52);

describe('parseListingAggregateId', () => {
  it('accepts both separators', () => {
    expect(parseListingAggregateId(`listing:${SELLER}_boots`)).toEqual({ sellerPubky: SELLER, listingId: 'boots' });
    expect(parseListingAggregateId(`listing:${SELLER}:boots`)).toEqual({ sellerPubky: SELLER, listingId: 'boots' });
  });

  it('rejects other prefixes, short pubkys and empty ids', () => {
    expect(parseListingAggregateId(`order:${SELLER}_boots`)).toBeNull();
    expect(parseListingAggregateId(`listing:${'s'.repeat(51)}_boots`)).toBeNull();
    expect(parseListingAggregateId(`listing:${SELLER}_`)).toBeNull();
  });
});

describe('listingIdFromOrder', () => {
  it('reads the first line and tolerates empty orders', () => {
    expect(
      listingIdFromOrder({ sellerPubky: SELLER, lines: [{ listingAggregateId: `listing:${SELLER}_boots` }] }),
    ).toBe('boots');
    expect(listingIdFromOrder({ sellerPubky: SELLER, lines: [] })).toBeNull();
  });
});

describe('aggregateSuffix', () => {
  it('reads the id after its prefix only', () => {
    expect(aggregateSuffix('order:o_1', 'order:')).toBe('o_1');
    expect(aggregateSuffix('offer:o_1', 'order:')).toBeNull();
  });
});

describe('sellerOfDropAggregateId', () => {
  it('reads the seller before the first underscore of a drop id', () => {
    expect(sellerOfDropAggregateId(`drop:${SELLER}_spring_01`)).toBe(SELLER);
    expect(sellerOfDropAggregateId(`listing:${SELLER}_boots`)).toBeNull();
    expect(sellerOfDropAggregateId('drop:_spring')).toBeNull();
    expect(sellerOfDropAggregateId(`drop:${SELLER}`)).toBeNull();
  });
});
