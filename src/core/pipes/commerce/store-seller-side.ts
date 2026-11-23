import { aggregateSuffix, parseListingAggregateId, sellerOfDropAggregateId } from '@/libs/commerce/listing-aggregate';

/**
 * A store's selling tools belong to the store seller. Any other account signed in to a store sees
 * and runs only its buyer side: its offers, orders and notifications as a seller are dropped here,
 * and its background seller work does not run. `storeSeller` is `null` outside store mode, where
 * everyone sells as before.
 */
export function canSellHere(viewerPubky: string, storeSeller: string | null): boolean {
  return storeSeller === null || viewerPubky === storeSeller;
}

/** Service rows that name their seller (orders, offers), without the viewer's sales where it cannot sell. */
export function withoutSalesOutsideStoreSeller<T extends { sellerPubky: string }>(
  rows: T[],
  viewerPubky: string,
  storeSeller: string | null,
): T[] {
  if (canSellHere(viewerPubky, storeSeller)) return rows;
  return rows.filter((row) => row.sellerPubky !== viewerPubky);
}

/** A notification row; one this build does not recognize carries no subject. */
type SubjectNotification = {
  id: string;
  aggregateId?: string;
  moderationDecision?: { restriction: string } | null;
};

const SELLER_MODERATION_RESTRICTIONS: ReadonlySet<string> = new Set(['listing_removed', 'shop_suspended']);

/**
 * Marketplace notifications without those about the viewer's selling where it cannot sell: an order
 * or offer it is the seller of, its own listing or drop, or a moderation decision on its listing or
 * shop. A notification names an order or offer only by id, so they are resolved through the viewer's
 * unfiltered `orders` and `offers`; one they do not name is dropped too, as its link opens nothing.
 * Conversations, review decisions and rows this build does not recognize are kept.
 */
export function withoutSalesNotificationsOutsideStoreSeller<T extends SubjectNotification>(
  notifications: T[],
  viewerPubky: string,
  storeSeller: string | null,
  context: {
    orders: readonly { id: string; sellerPubky: string }[];
    offers: readonly { id: string; sellerPubky: string }[];
  },
): T[] {
  if (canSellHere(viewerPubky, storeSeller)) return notifications;
  const orderSellers = new Map(context.orders.map((order) => [order.id, order.sellerPubky]));
  const offerSellers = new Map(context.offers.map((offer) => [offer.id, offer.sellerPubky]));
  const isSellerSide = ({ aggregateId, moderationDecision }: T): boolean => {
    if (moderationDecision && SELLER_MODERATION_RESTRICTIONS.has(moderationDecision.restriction)) return true;
    if (aggregateId === undefined) return false;
    const orderId = aggregateSuffix(aggregateId, 'order:');
    if (orderId !== null) return (orderSellers.get(orderId) ?? viewerPubky) === viewerPubky;
    const offerId = aggregateSuffix(aggregateId, 'offer:');
    if (offerId !== null) return (offerSellers.get(offerId) ?? viewerPubky) === viewerPubky;
    const listing = parseListingAggregateId(aggregateId);
    if (listing) return listing.sellerPubky === viewerPubky;
    return sellerOfDropAggregateId(aggregateId) === viewerPubky;
  };
  return notifications.filter((notification) => !isSellerSide(notification));
}
