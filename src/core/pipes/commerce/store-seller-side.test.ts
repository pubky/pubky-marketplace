import { describe, expect, it } from 'vitest';
import {
  canSellHere,
  isSaleSubject,
  subjectOfAggregate,
  withoutSalesNotificationsOutsideStoreSeller,
  withoutSalesOutsideStoreSeller,
} from './store-seller-side';

const STORE_SELLER = 's'.repeat(52);
const VIEWER = 'v'.repeat(52);
const OTHER = 'o'.repeat(52);

const rows = [
  { id: 'bought-from-store', sellerPubky: STORE_SELLER },
  { id: 'bought-elsewhere', sellerPubky: OTHER },
  { id: 'sold-by-viewer', sellerPubky: VIEWER },
];

const ids = (list: { id: string }[]) => list.map(({ id }) => id);

describe('canSellHere', () => {
  it('lets nobody signed out sell in a store, and everyone outside store mode', () => {
    expect(canSellHere(null, STORE_SELLER)).toBe(false);
    expect(canSellHere(null, null)).toBe(true);
  });

  it('lets only the store seller sell in a store, and everyone outside store mode', () => {
    expect(canSellHere(VIEWER, STORE_SELLER)).toBe(false);
    expect(canSellHere(STORE_SELLER, STORE_SELLER)).toBe(true);
    expect(canSellHere(VIEWER, null)).toBe(true);
  });
});

describe('subjectOfAggregate', () => {
  it('names the seller of listings, drops and conversations', () => {
    for (const aggregateId of [
      `listing:${VIEWER}_boots`,
      `drop:${VIEWER}_summer`,
      `conversation:${VIEWER}_${OTHER}_boots`,
    ]) {
      expect(subjectOfAggregate(aggregateId)).toEqual({ kind: 'seller', sellerPubky: VIEWER });
    }
  });

  it('names the id of orders and offers, nothing for checkouts, payments and notifications', () => {
    expect(subjectOfAggregate('order:o-1')).toEqual({ kind: 'order', id: 'o-1' });
    expect(subjectOfAggregate('offer:f-1')).toEqual({ kind: 'offer', id: 'f-1' });
    for (const aggregateId of ['checkout:c', 'payment:p', 'notification:n', 'notification_preferences:x']) {
      expect(subjectOfAggregate(aggregateId)).toEqual({ kind: 'none' });
    }
  });

  it('is unknown for anything else, or a malformed id', () => {
    for (const aggregateId of ['moderation_decision:m', 'seller_settings:x', 'drop:summer', 'order:', 'shop']) {
      expect(subjectOfAggregate(aggregateId)).toEqual({ kind: 'unknown' });
    }
  });
});

describe('isSaleSubject', () => {
  const sellers = new Map([
    ['sold', VIEWER],
    ['bought', STORE_SELLER],
  ]);
  const sellerOf = (_kind: 'order' | 'offer', id: string) => sellers.get(id) ?? null;
  const isSale = (aggregateId: string) => isSaleSubject(subjectOfAggregate(aggregateId), VIEWER, sellerOf);

  it('is a sale when the viewer sells the subject', () => {
    expect(isSale(`listing:${VIEWER}_boots`)).toBe(true);
    expect(isSale(`conversation:${VIEWER}_${OTHER}_boots`)).toBe(true);
    expect(isSale('order:sold')).toBe(true);
    expect(isSale('offer:sold')).toBe(true);
  });

  it('is not a sale when another seller sells it, or it has no seller side', () => {
    expect(isSale(`listing:${STORE_SELLER}_boots`)).toBe(false);
    expect(isSale(`conversation:${STORE_SELLER}_${VIEWER}_boots`)).toBe(false);
    expect(isSale('order:bought')).toBe(false);
    expect(isSale('payment:p')).toBe(false);
  });

  it('counts what it cannot tell as a sale', () => {
    expect(isSale('order:missing')).toBe(true);
    expect(isSale('moderation_decision:m')).toBe(true);
  });
});

describe('withoutSalesOutsideStoreSeller', () => {
  it('drops the rows another signed-in seller sold in a store', () => {
    expect(ids(withoutSalesOutsideStoreSeller(rows, VIEWER, STORE_SELLER))).toEqual([
      'bought-from-store',
      'bought-elsewhere',
    ]);
  });

  it('keeps every row for the store seller', () => {
    const storeSellerRows = [...rows, { id: 'sold-by-store', sellerPubky: STORE_SELLER }];
    expect(withoutSalesOutsideStoreSeller(storeSellerRows, STORE_SELLER, STORE_SELLER)).toBe(storeSellerRows);
  });

  it('keeps every row outside store mode', () => {
    expect(withoutSalesOutsideStoreSeller(rows, VIEWER, null)).toBe(rows);
  });
});

describe('withoutSalesNotificationsOutsideStoreSeller', () => {
  const context = {
    orders: [
      { id: 'bought', sellerPubky: STORE_SELLER },
      { id: 'sold', sellerPubky: VIEWER },
    ],
    offers: [
      { id: 'made', sellerPubky: OTHER },
      { id: 'received', sellerPubky: VIEWER },
    ],
  };
  const notifications = [
    { id: 'order-bought', aggregateId: 'order:bought' },
    { id: 'order-sold', aggregateId: 'order:sold' },
    { id: 'order-unknown', aggregateId: 'order:unknown' },
    { id: 'offer-made', aggregateId: 'offer:made' },
    { id: 'offer-received', aggregateId: 'offer:received' },
    { id: 'outbid', aggregateId: `listing:${STORE_SELLER}_boots` },
    { id: 'auction-ended', aggregateId: `listing:${VIEWER}_boots` },
    { id: 'drop-sold-out', aggregateId: `drop:${VIEWER}_spring` },
    { id: 'message', aggregateId: 'conversation:1' },
    {
      id: 'listing-removed',
      aggregateId: 'moderation_decision:1',
      moderationDecision: { restriction: 'listing_removed' },
    },
    {
      id: 'shop-suspended',
      aggregateId: 'moderation_decision:2',
      moderationDecision: { restriction: 'shop_suspended' },
    },
    {
      id: 'review-hidden',
      aggregateId: 'moderation_decision:3',
      moderationDecision: { restriction: 'review_text_hidden' },
    },
    { id: 'unrecognized' },
  ];

  it('drops the notifications about another signed-in seller selling in a store', () => {
    expect(ids(withoutSalesNotificationsOutsideStoreSeller(notifications, VIEWER, STORE_SELLER, context))).toEqual([
      'order-bought',
      'offer-made',
      'outbid',
      'message',
      'review-hidden',
      'unrecognized',
    ]);
  });

  it('keeps every notification for the store seller', () => {
    expect(withoutSalesNotificationsOutsideStoreSeller(notifications, STORE_SELLER, STORE_SELLER, context)).toBe(
      notifications,
    );
  });

  it('keeps every notification outside store mode', () => {
    expect(withoutSalesNotificationsOutsideStoreSeller(notifications, VIEWER, null, context)).toBe(notifications);
  });
});
