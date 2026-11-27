import { describe, expect, it } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import {
  canSellHere,
  CONFLICTING_COUNTERPARTY,
  isSaleSubject,
  isSaleThread,
  type ListingSide,
  mergeStoreThreadRoles,
  storeNotificationSubjects,
  storeThreadRoles,
  subjectOfAggregate,
  withoutSalesNotificationsOutsideStoreSeller,
  withoutSalesOutsideStoreSeller,
} from './store-seller-side';

const STORE_SELLER = 's'.repeat(52);
const VIEWER = 'v'.repeat(52);
const OTHER = 'o'.repeat(52);
const OFF: StoreState = { kind: 'off' };
const CLAIMED: StoreState = { kind: 'claimed', seller: STORE_SELLER, source: 'pinned', claimMode: false };
const UNCLAIMED: StoreState = { kind: 'unclaimed', claimMode: true };
const UNAVAILABLE: StoreState = { kind: 'unavailable', claimMode: true };

const rows = [
  { id: 'bought-from-store', sellerPubky: STORE_SELLER },
  { id: 'bought-elsewhere', sellerPubky: OTHER },
  { id: 'sold-by-viewer', sellerPubky: VIEWER },
];

const ids = (list: { id: string }[]) => list.map(({ id }) => id);

describe('canSellHere', () => {
  it('lets everyone sell when store mode is off', () => {
    expect(canSellHere(null, OFF)).toBe(true);
    expect(canSellHere(VIEWER, OFF)).toBe(true);
  });

  it('lets only the store seller sell in a claimed store', () => {
    expect(canSellHere(null, CLAIMED)).toBe(false);
    expect(canSellHere(VIEWER, CLAIMED)).toBe(false);
    expect(canSellHere(STORE_SELLER, CLAIMED)).toBe(true);
  });

  it.each([UNCLAIMED, UNAVAILABLE])('lets nobody sell while the store is $kind', (state) => {
    expect(canSellHere(null, state)).toBe(false);
    expect(canSellHere(STORE_SELLER, state)).toBe(false);
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
    expect(ids(withoutSalesOutsideStoreSeller(rows, VIEWER, CLAIMED))).toEqual([
      'bought-from-store',
      'bought-elsewhere',
    ]);
  });

  it('keeps every row for the store seller', () => {
    const storeSellerRows = [...rows, { id: 'sold-by-store', sellerPubky: STORE_SELLER }];
    expect(withoutSalesOutsideStoreSeller(storeSellerRows, STORE_SELLER, CLAIMED)).toBe(storeSellerRows);
  });

  it('keeps every row outside store mode', () => {
    expect(withoutSalesOutsideStoreSeller(rows, VIEWER, OFF)).toBe(rows);
  });
});

describe('storeNotificationSubjects', () => {
  it('names the orders, offers and moderated reviews a notification list needs resolved, once each', () => {
    expect(
      storeNotificationSubjects([
        { type: 'order_created', aggregateId: 'order:o-1' },
        { type: 'order_shipped', aggregateId: 'order:o-1' },
        { type: 'offer_received', aggregateId: 'offer:f-1' },
        { type: 'outbid', aggregateId: `listing:${OTHER}_boots` },
        {
          type: 'moderation_decision',
          aggregateId: 'moderation_decision:1',
          moderationDecision: { restriction: 'review_excluded', targetUri: 'pubky://review' },
        },
        {
          type: 'moderation_decision',
          aggregateId: 'moderation_decision:2',
          moderationDecision: { restriction: 'listing_removed', targetUri: 'pubky://listing' },
        },
        { kind: 'unrecognized', type: 'order_created', aggregateId: 'order:o-2' },
      ]),
    ).toEqual({ orderIds: ['o-1'], offerIds: ['f-1'], reviewUris: ['pubky://review'] });
  });
});

describe('withoutSalesNotificationsOutsideStoreSeller', () => {
  const roles = {
    orderSellers: new Map<string, string | null>([
      ['bought', STORE_SELLER],
      ['sold', VIEWER],
      ['unreadable', null],
    ]),
    offerSellers: new Map<string, string | null>([
      ['made', OTHER],
      ['received', VIEWER],
    ]),
    reviewRoles: new Map<string, 'buyer' | 'seller' | null>([
      ['pubky://review-as-buyer', 'buyer'],
      ['pubky://review-as-seller', 'seller'],
    ]),
  };
  const decision = (id: string, restriction: string, targetUri = 'pubky://target') => ({
    id,
    type: 'moderation_decision',
    aggregateId: `moderation_decision:${id}`,
    moderationDecision: { restriction, targetUri },
  });
  const notifications = [
    { id: 'order-bought', type: 'payment_confirmed', aggregateId: 'order:bought' },
    { id: 'order-sold', type: 'order_created', aggregateId: 'order:sold' },
    { id: 'order-unreadable', type: 'bitcoin_payment_seen', aggregateId: 'order:unreadable' },
    { id: 'order-unknown', type: 'order_created', aggregateId: 'order:unknown' },
    { id: 'offer-made', type: 'offer_accepted', aggregateId: 'offer:made' },
    { id: 'offer-received', type: 'offer_received', aggregateId: 'offer:received' },
    { id: 'outbid', type: 'outbid', aggregateId: `listing:${STORE_SELLER}_boots` },
    { id: 'auction-ended', type: 'auction_ended', aggregateId: `listing:${VIEWER}_boots` },
    { id: 'drop-sold-out', type: 'drop_sold_out', aggregateId: `drop:${VIEWER}_spring` },
    { id: 'message-bought', type: 'message_received', aggregateId: `conversation:${STORE_SELLER}_${VIEWER}_boots` },
    { id: 'message-sold', type: 'message_received', aggregateId: `conversation:${VIEWER}_${OTHER}_boots` },
    { id: 'checkout', type: 'payment_method_bound', aggregateId: 'checkout:1' },
    decision('listing-removed', 'listing_removed'),
    decision('shop-suspended', 'shop_suspended'),
    decision('review-hidden-as-buyer', 'review_text_hidden', 'pubky://review-as-buyer'),
    decision('review-excluded-as-buyer', 'review_excluded', 'pubky://review-as-buyer'),
    decision('review-hidden-as-seller', 'review_text_hidden', 'pubky://review-as-seller'),
    decision('review-excluded-unknown', 'review_excluded', 'pubky://someone-else'),
    {
      id: 'decision-unreadable',
      type: 'moderation_decision',
      aggregateId: 'moderation_decision:9',
      moderationDecision: null,
    },
    { id: 'quarantined', kind: 'unrecognized', type: 'payment_confirmed' },
    { id: 'unknown-aggregate', type: 'payment_confirmed', aggregateId: 'shop:1' },
  ];

  it('keeps only what another signed-in seller bought in a store, and hides what it cannot tell', () => {
    expect(ids(withoutSalesNotificationsOutsideStoreSeller(notifications, VIEWER, CLAIMED, roles))).toEqual([
      'order-bought',
      'offer-made',
      'outbid',
      'message-bought',
      'checkout',
      'review-hidden-as-buyer',
      'review-excluded-as-buyer',
    ]);
  });

  it('keeps every notification for the store seller', () => {
    expect(withoutSalesNotificationsOutsideStoreSeller(notifications, STORE_SELLER, CLAIMED, roles)).toBe(
      notifications,
    );
  });

  it('keeps every notification outside store mode', () => {
    expect(withoutSalesNotificationsOutsideStoreSeller(notifications, VIEWER, OFF, roles)).toBe(notifications);
  });
});

describe('isSaleThread', () => {
  const BUYER = 'b'.repeat(52);
  const roles = storeThreadRoles(
    [
      { id: 'bought', buyerPubky: VIEWER, sellerPubky: STORE_SELLER },
      { id: 'bought-from-prior-peer', buyerPubky: VIEWER, sellerPubky: 'p'.repeat(52) },
      { id: 'sold', buyerPubky: BUYER, sellerPubky: VIEWER },
      { id: 'resolved-sold', buyerPubky: 'r'.repeat(52), sellerPubky: VIEWER },
      { id: 'sold-to-store-seller', buyerPubky: STORE_SELLER, sellerPubky: VIEWER },
      { id: 'sold-to-prior-peer', buyerPubky: 'p'.repeat(52), sellerPubky: VIEWER },
    ],
    VIEWER,
  );
  const isSale = (
    peer: string,
    context: { orderId?: string; listingId?: string } | null,
    listingSide: ListingSide | null = null,
  ) => isSaleThread({ peer_pubky: peer, last_context: context }, roles, CLAIMED, listingSide);

  it('is a sale thread with a buyer of the viewer, about an order it sold, or about its own listing', () => {
    expect(isSale(BUYER, null)).toBe(true);
    expect(isSale(OTHER, { orderId: 'sold' })).toBe(true);
    expect(isSale(OTHER, { listingId: 'boots' }, 'viewer')).toBe(true);
  });

  it('stays a buyer thread whenever anything makes it a purchase', () => {
    expect(isSale(STORE_SELLER, null)).toBe(false);
    expect(isSale(STORE_SELLER, { orderId: 'sold-to-store-seller' })).toBe(false);
    expect(isSale('p'.repeat(52), { orderId: 'bought-from-prior-peer' })).toBe(false);
    expect(isSale(BUYER, { listingId: 'boots' }, 'peer')).toBe(false);
  });

  it.each([
    {
      name: 'order known bought from this peer',
      peer: 'p'.repeat(52),
      context: { orderId: 'bought-from-prior-peer' },
      side: null,
      sale: false,
    },
    { name: 'order known sold', peer: OTHER, context: { orderId: 'sold' }, side: null, sale: true },
    {
      name: 'order missing from the page but resolved by id as sold',
      peer: 'r'.repeat(52),
      context: { orderId: 'resolved-sold' },
      side: null,
      sale: true,
    },
    {
      name: 'order missing from the page and unresolvable',
      peer: OTHER,
      context: { orderId: 'unknown' },
      side: null,
      sale: true,
    },
    {
      name: 'order lookup throws',
      peer: OTHER,
      context: { orderId: 'failed-order' },
      side: null,
      sale: true,
    },
    { name: 'listing peer', peer: OTHER, context: { listingId: 'boots' }, side: 'peer', sale: false },
    { name: 'listing viewer', peer: OTHER, context: { listingId: 'boots' }, side: 'viewer', sale: true },
    { name: 'listing absent', peer: OTHER, context: { listingId: 'gone' }, side: 'absent', sale: false },
    { name: 'listing lookup failed', peer: OTHER, context: { listingId: 'gone' }, side: null, sale: true },
    { name: 'no context', peer: OTHER, context: null, side: null, sale: false },
    {
      name: 'store seller with an unresolved context',
      peer: STORE_SELLER,
      context: { orderId: 'unknown' },
      side: null,
      sale: false,
    },
  ] as const)('classifies $name fail closed where needed', ({ peer, context, side, sale }) => {
    expect(isSale(peer, context, side)).toBe(sale);
  });

  it('closes a thread whose latest context is the viewer sale even when the viewer bought from that peer too', () => {
    const peer = 'p'.repeat(52);
    expect(isSale(peer, { orderId: 'sold-to-prior-peer' })).toBe(true);
    expect(isSale(peer, { orderId: 'sold-to-prior-peer', listingId: 'my-lamp' }, 'viewer')).toBe(true);
    expect(isSale(peer, { listingId: 'my-lamp' }, 'viewer')).toBe(true);
    expect(isSale(peer, { orderId: 'bought-from-prior-peer' })).toBe(false);
    expect(isSale(peer, { listingId: 'boots' }, 'peer')).toBe(false);
  });

  it('closes a thread whose latest context is unresolved even when the peer sold to the viewer before', () => {
    const peer = 'p'.repeat(52);
    expect(isSale(peer, { orderId: 'unknown' })).toBe(true);
    expect(isSale(peer, { listingId: 'unreadable' }, null)).toBe(true);
    expect(isSale(peer, null)).toBe(false);
    expect(isSale(peer, { listingId: 'gone' }, 'absent')).toBe(false);
  });

  it.each([
    {
      name: 'a bought order and its own listing',
      context: { orderId: 'bought', listingId: 'my-lamp' },
      side: 'viewer',
      sale: true,
    },
    {
      name: 'a bought order and a listing whose lookup failed',
      context: { orderId: 'bought', listingId: 'unreadable' },
      side: null,
      sale: true,
    },
    {
      name: 'an order in neither list and a listing of the peer',
      context: { orderId: 'unknown', listingId: 'boots' },
      side: 'peer',
      sale: true,
    },
    {
      name: 'a sold order and a listing of the peer',
      context: { orderId: 'sold', listingId: 'boots' },
      side: 'peer',
      sale: true,
    },
    {
      name: 'a bought order and a listing of the peer',
      context: { orderId: 'bought-from-prior-peer', listingId: 'boots' },
      side: 'peer',
      sale: false,
    },
    {
      name: 'a bought order and a listing neither owner has',
      context: { orderId: 'bought-from-prior-peer', listingId: 'gone' },
      side: 'absent',
      sale: false,
    },
  ] as const)('judges a context with $name by its sale or unresolved half first', ({ context, side, sale }) => {
    expect(isSale(context.orderId === 'bought-from-prior-peer' ? 'p'.repeat(52) : OTHER, context, side)).toBe(sale);
  });

  it('counts an order as a purchase only in the thread with its seller', () => {
    const prior = 'p'.repeat(52);
    expect(isSale(prior, { orderId: 'bought-from-prior-peer' })).toBe(false);
    expect(isSale(OTHER, { orderId: 'bought-from-prior-peer' })).toBe(true);
    expect(isSale(BUYER, { orderId: 'bought' })).toBe(true);
    expect(isSale(prior, { orderId: 'bought' })).toBe(true);
    expect(isSale(prior, { orderId: 'bought', listingId: 'boots' }, 'peer')).toBe(true);
    expect(isSale(OTHER, { orderId: 'sold' })).toBe(true);
    expect(isSale(BUYER, { orderId: 'sold' })).toBe(true);
  });

  it('keeps a thread with a seller whose order the viewer bought even when it sold to someone else', () => {
    expect(isSale(STORE_SELLER, { orderId: 'bought' })).toBe(false);
    expect(isSale('p'.repeat(52), { orderId: 'bought-from-prior-peer', listingId: 'boots' }, 'peer')).toBe(false);
  });

  it('treats an order placed with two counterparties as a purchase in no thread', () => {
    const placed = (seller: string) =>
      storeThreadRoles([{ id: 'contested', buyerPubky: VIEWER, sellerPubky: seller }], VIEWER);
    const merged = mergeStoreThreadRoles(placed(OTHER), placed(STORE_SELLER));
    expect(merged.boughtOrders).toEqual({ contested: CONFLICTING_COUNTERPARTY });
    expect(mergeStoreThreadRoles(merged, placed(OTHER)).boughtOrders).toEqual({ contested: CONFLICTING_COUNTERPARTY });
    expect(mergeStoreThreadRoles(placed(OTHER), placed(OTHER)).boughtOrders).toEqual({ contested: OTHER });
    for (const peer of [OTHER, 'p'.repeat(52)]) {
      expect(isSaleThread({ peer_pubky: peer, last_context: { orderId: 'contested' } }, merged, CLAIMED, null)).toBe(
        true,
      );
    }
  });

  it('lets a resolved listing replace a failed lookup but never the reverse', () => {
    const key = `${OTHER}:boots`;
    const recorded = (side: 'unresolved' | ListingSide) => storeThreadRoles([], VIEWER, { [key]: side });
    expect(mergeStoreThreadRoles(recorded('unresolved'), recorded('peer')).listingSides[key]).toBe('peer');
    expect(mergeStoreThreadRoles(recorded('peer'), recorded('unresolved')).listingSides[key]).toBe('peer');
    expect(mergeStoreThreadRoles(recorded('unresolved'), recorded('unresolved')).listingSides[key]).toBe('unresolved');
  });

  it('keeps a listing the viewer owns as its own when roles are merged', () => {
    const key = `${OTHER}:boots`;
    const learned = (side: ListingSide) => storeThreadRoles([], VIEWER, { [key]: side });
    expect(mergeStoreThreadRoles(learned('viewer'), learned('peer')).listingSides[key]).toBe('viewer');
    expect(mergeStoreThreadRoles(learned('viewer'), learned('absent')).listingSides[key]).toBe('viewer');
    expect(mergeStoreThreadRoles(learned('peer'), learned('viewer')).listingSides[key]).toBe('viewer');
    expect(mergeStoreThreadRoles(learned('absent'), learned('peer')).listingSides[key]).toBe('peer');
  });

  it('shows only the thread with the store seller before the roles are read', () => {
    const unread = (peer: string, context: { orderId?: string } | null) =>
      isSaleThread({ peer_pubky: peer, last_context: context }, null, CLAIMED, null);
    expect(unread(STORE_SELLER, { orderId: 'bought' })).toBe(false);
    expect(unread(STORE_SELLER, null)).toBe(false);
    expect(unread(OTHER, null)).toBe(true);
    expect(unread(BUYER, { orderId: 'sold' })).toBe(true);
  });
});
