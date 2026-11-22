import { describe, expect, it } from 'vitest';
import {
  scopeListingRowsToStore,
  scopeNotificationsToStore,
  scopeSellerRowsToStore,
  sellerOfListingCompositeId,
} from './store-scope';

const STORE_SELLER = 's'.repeat(52);
const OTHER_SELLER = 'o'.repeat(52);
const BUYER = 'b'.repeat(52);

describe('sellerOfListingCompositeId', () => {
  it('reads the seller part of a composite listing id', () => {
    expect(sellerOfListingCompositeId(`${STORE_SELLER}:listing-1`)).toBe(STORE_SELLER);
    expect(sellerOfListingCompositeId('no-seller')).toBeNull();
    expect(sellerOfListingCompositeId(':listing-1')).toBeNull();
  });
});

describe('scopeListingRowsToStore', () => {
  const rows = [
    { id: 'a', listing_id: `${STORE_SELLER}:1` },
    { id: 'b', listing_id: `${OTHER_SELLER}:2` },
    { id: 'c', listing_id: 'malformed' },
  ];

  it('keeps only the store seller rows in a store', () => {
    expect(scopeListingRowsToStore(rows, STORE_SELLER).map((row) => row.id)).toEqual(['a']);
  });

  it('keeps every row outside store mode', () => {
    expect(scopeListingRowsToStore(rows, null)).toBe(rows);
  });
});

describe('scopeSellerRowsToStore', () => {
  const rows = [
    { id: 'a', sellerPubky: STORE_SELLER },
    { id: 'b', sellerPubky: OTHER_SELLER },
  ];

  it('keeps only rows sold by the store seller in a store', () => {
    expect(scopeSellerRowsToStore(rows, STORE_SELLER).map((row) => row.id)).toEqual(['a']);
  });

  it('keeps every row outside store mode', () => {
    expect(scopeSellerRowsToStore(rows, null)).toBe(rows);
  });
});

describe('scopeNotificationsToStore', () => {
  const context = {
    orders: [
      { id: 'order-store', sellerPubky: STORE_SELLER },
      { id: 'order-other', sellerPubky: OTHER_SELLER },
    ],
    offers: [
      { id: 'offer-store', sellerPubky: STORE_SELLER },
      { id: 'offer-other', sellerPubky: OTHER_SELLER },
    ],
  };
  const row = (id: string, aggregateId: string, actorPubky = 'system') => ({
    id,
    aggregateId,
    actorPubky,
    recipientPubky: BUYER,
  });

  it('keeps notifications about the store seller listings, drops, orders and offers', () => {
    const notifications = [
      row('order-store', 'order:order-store'),
      row('order-other', 'order:order-other'),
      row('order-unknown', 'order:missing'),
      row('offer-store', 'offer:offer-store'),
      row('offer-other', 'offer:offer-other'),
      row('listing-store', `listing:${STORE_SELLER}_1`),
      row('listing-store-colon', `listing:${STORE_SELLER}:1`),
      row('listing-other', `listing:${OTHER_SELLER}_1`),
      row('drop-store', `drop:${STORE_SELLER}_d1`),
      row('drop-other', `drop:${OTHER_SELLER}_d1`),
    ];

    expect(scopeNotificationsToStore(notifications, STORE_SELLER, context).map(({ id }) => id)).toEqual([
      'order-store',
      'offer-store',
      'listing-store',
      'listing-store-colon',
      'drop-store',
    ]);
  });

  it('keeps an unresolvable subject only when the store seller sent or received it', () => {
    const notifications = [
      row('from-store', 'conversation:1', STORE_SELLER),
      row('from-other', 'conversation:2', OTHER_SELLER),
      { id: 'to-store', aggregateId: 'conversation:3', actorPubky: BUYER, recipientPubky: STORE_SELLER },
      { id: 'unrecognized' },
    ];

    expect(scopeNotificationsToStore(notifications, STORE_SELLER, context).map(({ id }) => id)).toEqual([
      'from-store',
      'to-store',
    ]);
  });

  it('keeps every notification outside store mode', () => {
    const notifications = [row('a', 'order:order-other'), { id: 'unrecognized' }];
    expect(scopeNotificationsToStore(notifications, null, context)).toBe(notifications);
  });
});
