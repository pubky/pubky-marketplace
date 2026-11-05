import { describe, expect, it } from 'vitest';
import {
  isOpenOrderState,
  listingDeleteConfirmLabel,
  listingDeleteFailureMessage,
  listingDeleteOpenOrdersNote,
  listingDeleteTitle,
  openOrderCountsByListing,
} from './listing-delete';

const SELLER = 'seller-pubky';
const line = (listingAggregateId: string) => ({ listingAggregateId });

describe('isOpenOrderState', () => {
  it.each([
    'pending_payment',
    'paid',
    'ready_for_pickup',
    'processing',
    'shipped',
    'cancel_requested',
    'return_requested',
  ])('counts %s as open', (state) => expect(isOpenOrderState(state)).toBe(true));

  it.each(['delivered', 'completed', 'cancelled', 'refunded_external', 'refunded_partial', 'closed'])(
    'counts %s as settled',
    (state) => expect(isOpenOrderState(state)).toBe(false),
  );
});

describe('openOrderCountsByListing', () => {
  it('counts open orders per listing, once per order, for the seller only', () => {
    const counts = openOrderCountsByListing(
      [
        { sellerPubky: SELLER, state: 'paid', lines: [line('a'), line('a'), line('b')] },
        { sellerPubky: SELLER, state: 'pending_payment', lines: [line('a')] },
        { sellerPubky: SELLER, state: 'completed', lines: [line('a')] },
        { sellerPubky: 'someone-else', state: 'paid', lines: [line('a')] },
      ],
      SELLER,
    );

    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.has('c')).toBe(false);
  });
});

describe('listing delete copy', () => {
  it('names one listing or a count', () => {
    expect(listingDeleteTitle(1)).toBe('Delete this listing?');
    expect(listingDeleteTitle(3)).toBe('Delete 3 listings?');
    expect(listingDeleteConfirmLabel(1)).toBe('Delete listing');
    expect(listingDeleteConfirmLabel(3)).toBe('Delete 3 listings');
  });

  it('pluralises the open-order warning', () => {
    expect(listingDeleteOpenOrdersNote(1, 1)).toContain('1 open order.');
    expect(listingDeleteOpenOrdersNote(2, 1)).toContain('2 open orders.');
    expect(listingDeleteOpenOrdersNote(2, 3)).toContain('between them');
  });

  it('says how many failed when a bulk delete is partial', () => {
    expect(listingDeleteFailureMessage(1, 1)).toBe('Could not delete this listing.');
    expect(listingDeleteFailureMessage(2, 3)).toBe('Could not delete 2 of 3 listings. The others were deleted.');
    expect(listingDeleteFailureMessage(3, 3)).toBe('Could not delete these 3 listings.');
  });
});
