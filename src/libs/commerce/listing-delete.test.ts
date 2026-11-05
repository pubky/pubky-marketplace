import { describe, expect, it } from 'vitest';
import {
  countOpenOrdersForListings,
  deletableTargets,
  isOpenOrderState,
  listingDeleteConfirmLabel,
  listingDeleteFailureMessage,
  listingDeleteOpenOrdersNote,
  listingDeleteSummary,
  listingDeleteTitle,
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

describe('countOpenOrdersForListings', () => {
  const order = (id: string, state: string, ...ids: string[]) => ({
    id,
    sellerPubky: SELLER,
    state,
    lines: ids.map(line),
  });

  it('counts the seller’s open orders on the given listings only', () => {
    const count = countOpenOrdersForListings(
      [
        order('1', 'paid', 'a'),
        order('2', 'pending_payment', 'a'),
        order('3', 'completed', 'a'),
        order('4', 'paid', 'other'),
        { ...order('5', 'paid', 'a'), sellerPubky: 'someone-else' },
      ],
      SELLER,
      new Set(['a']),
    );

    expect(count).toBe(2);
  });

  it('counts an order once however many of the listings its lines name', () => {
    expect(countOpenOrdersForListings([order('1', 'paid', 'a', 'a', 'b')], SELLER, new Set(['a', 'b']))).toBe(1);
  });
});

describe('deletableTargets', () => {
  const ref = (listingId: string) => ({ ownerPubky: SELLER, listingId });

  it('leaves out the targets the plan holds back', () => {
    expect(deletableTargets({ targets: [ref('a'), ref('b'), ref('c')], blocked: [{ target: ref('b') }] })).toEqual([
      ref('a'),
      ref('c'),
    ]);
  });
});

describe('listing delete copy', () => {
  it('names one listing or a count', () => {
    expect(listingDeleteTitle(1)).toBe('Delete this listing?');
    expect(listingDeleteTitle(3)).toBe('Delete 3 listings?');
    expect(listingDeleteConfirmLabel(1)).toBe('Delete listing');
    expect(listingDeleteConfirmLabel(3)).toBe('Delete 3 listings');
  });

  it('promises only the record deletion, because photo cleanup is best-effort', () => {
    expect(listingDeleteSummary(1)).not.toMatch(/photo/i);
    expect(listingDeleteSummary(3)).not.toMatch(/photo/i);
    expect(listingDeleteSummary(1)).toContain('removes the owner-signed record from your homeserver');
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
