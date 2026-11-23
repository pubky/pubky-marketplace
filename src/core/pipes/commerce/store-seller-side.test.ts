import { describe, expect, it } from 'vitest';
import {
  canSellHere,
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
  it('lets only the store seller sell in a store, and everyone outside store mode', () => {
    expect(canSellHere(VIEWER, STORE_SELLER)).toBe(false);
    expect(canSellHere(STORE_SELLER, STORE_SELLER)).toBe(true);
    expect(canSellHere(VIEWER, null)).toBe(true);
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
