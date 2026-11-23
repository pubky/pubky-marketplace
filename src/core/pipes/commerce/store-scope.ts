import { aggregateSuffix, parseListingAggregateId, sellerOfDropAggregateId } from '@/libs/commerce/listing-aggregate';

/**
 * A store (store mode) shows a buyer only what they have with the store seller. The same account's
 * watchlist, cart and service rows may hold other sellers' items, for example from the hosted Market,
 * so every list a store shows is cut to the store seller here. `storeSeller` is `null` outside store
 * mode, where every row is kept. For the store seller signed in, the rows kept are those of their own
 * shop: what they sell, not what they buy elsewhere.
 */

/** The seller of a composite `seller:listingId` listing id, or `null` when it has no seller part. */
export function sellerOfListingCompositeId(listingCompositeId: string): string | null {
  const separator = listingCompositeId.indexOf(':');
  return separator > 0 ? listingCompositeId.slice(0, separator) : null;
}

/** Local rows keyed by a composite listing id (cart items, favorites, watch snapshots and alerts). */
export function scopeListingRowsToStore<T extends { listing_id: string }>(rows: T[], storeSeller: string | null): T[] {
  if (storeSeller === null) return rows;
  return rows.filter((row) => sellerOfListingCompositeId(row.listing_id) === storeSeller);
}

/** Service rows that name their seller (orders, offers). */
export function scopeSellerRowsToStore<T extends { sellerPubky: string }>(rows: T[], storeSeller: string | null): T[] {
  if (storeSeller === null) return rows;
  return rows.filter((row) => row.sellerPubky === storeSeller);
}

/** A notification row; one this build does not recognize carries no subject or parties. */
type ScopedNotification = { id: string; aggregateId?: string; actorPubky?: string; recipientPubky?: string };

/**
 * Marketplace notifications about the store seller's listings, drops, orders and offers. A
 * notification names its subject only by aggregate id, so orders and offers are resolved through the
 * viewer's own `orders` and `offers`. A subject it cannot resolve (a conversation, or a row this
 * build does not know) is kept only when the store seller sent or received it; a row this build
 * does not recognize at all is dropped.
 */
export function scopeNotificationsToStore<T extends ScopedNotification>(
  notifications: T[],
  storeSeller: string | null,
  context: {
    orders: readonly { id: string; sellerPubky: string }[];
    offers: readonly { id: string; sellerPubky: string }[];
  },
): T[] {
  if (storeSeller === null) return notifications;
  const orderSellers = new Map(context.orders.map((order) => [order.id, order.sellerPubky]));
  const offerSellers = new Map(context.offers.map((offer) => [offer.id, offer.sellerPubky]));
  return notifications.filter((notification) => {
    const { aggregateId } = notification;
    if (aggregateId === undefined) return false;
    const orderId = aggregateSuffix(aggregateId, 'order:');
    if (orderId !== null) return orderSellers.get(orderId) === storeSeller;
    const offerId = aggregateSuffix(aggregateId, 'offer:');
    if (offerId !== null) return offerSellers.get(offerId) === storeSeller;
    const listing = parseListingAggregateId(aggregateId);
    if (listing) return listing.sellerPubky === storeSeller;
    const dropSeller = sellerOfDropAggregateId(aggregateId);
    if (dropSeller !== null) return dropSeller === storeSeller;
    return notification.actorPubky === storeSeller || notification.recipientPubky === storeSeller;
  });
}
