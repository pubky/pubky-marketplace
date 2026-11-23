import { parseListingAggregateId } from '@/libs/commerce/listing-aggregate';

/**
 * A store's selling tools belong to the store seller. Any other account signed in to a store sees
 * and runs only its buyer side. `storeSeller` is `null` outside store mode, where everyone sells as
 * before. Controllers ask through `StoreSellerGate`, never here directly.
 */
export function canSellHere(viewerPubky: string | null, storeSeller: string | null): boolean {
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

/**
 * What an aggregate id names, for telling the viewer's buyer side from its seller side. Listings,
 * drops and conversations carry their seller (`listing:<seller>_<id>`, `drop:<seller>_<id>`,
 * `conversation:<seller>_<buyer>_<listing>`). Orders and offers carry only their id, so the caller
 * resolves their seller from the viewer's rows. Checkouts, payments and the viewer's own
 * notification rows have no seller side. Any other aggregate is `unknown`.
 */
type MarketplaceSubject =
  | { kind: 'seller'; sellerPubky: string }
  | { kind: 'order' | 'offer'; id: string }
  | { kind: 'none' }
  | { kind: 'unknown' };

const SUBJECTLESS_PREFIXES = ['checkout:', 'payment:', 'notification:', 'notification_preferences:'];

/** The pubky before the first `_` of what follows `prefix`; pubkys never contain `_`. */
function leadingPubky(aggregateId: string, prefix: string): string | null {
  const rest = aggregateId.slice(prefix.length);
  const separator = rest.indexOf('_');
  return separator > 0 ? rest.slice(0, separator) : null;
}

export function subjectOfAggregate(aggregateId: string): MarketplaceSubject {
  const listing = parseListingAggregateId(aggregateId);
  if (listing) return { kind: 'seller', sellerPubky: listing.sellerPubky };
  for (const prefix of ['drop:', 'conversation:']) {
    if (!aggregateId.startsWith(prefix)) continue;
    const sellerPubky = leadingPubky(aggregateId, prefix);
    return sellerPubky ? { kind: 'seller', sellerPubky } : { kind: 'unknown' };
  }
  for (const kind of ['order', 'offer'] as const) {
    const prefix = `${kind}:`;
    if (aggregateId.startsWith(prefix) && aggregateId.length > prefix.length) {
      return { kind, id: aggregateId.slice(prefix.length) };
    }
  }
  if (SUBJECTLESS_PREFIXES.some((prefix) => aggregateId.startsWith(prefix))) return { kind: 'none' };
  return { kind: 'unknown' };
}

/**
 * Whether a subject is the viewer's sale. `sellerOf` resolves an order or offer id to its seller,
 * or `null` when the viewer's rows do not name it. Unresolved and unknown subjects count as sales,
 * so a caller that cannot tell the side keeps it from a viewer who cannot sell here.
 */
export function isSaleSubject(
  subject: MarketplaceSubject,
  viewerPubky: string,
  sellerOf: (kind: 'order' | 'offer', id: string) => string | null,
): boolean {
  switch (subject.kind) {
    case 'seller':
      return subject.sellerPubky === viewerPubky;
    case 'order':
    case 'offer': {
      const sellerPubky = sellerOf(subject.kind, subject.id);
      return sellerPubky === null || sellerPubky === viewerPubky;
    }
    case 'none':
      return false;
    case 'unknown':
      return true;
  }
}
/** A notification row; one this build does not recognize carries no subject. */
type SubjectNotification = {
  id: string;
  aggregateId?: string;
  moderationDecision?: { restriction: string } | null;
};

const SELLER_MODERATION_RESTRICTIONS: ReadonlySet<string> = new Set(['listing_removed', 'shop_suspended']);

function aggregateSuffix(aggregateId: string, prefix: string): string | null {
  return aggregateId.startsWith(prefix) ? aggregateId.slice(prefix.length) : null;
}

/** `drop:<seller>_<dropId>`; pubkys never contain `_`. */
function sellerOfDropAggregateId(aggregateId: string): string | null {
  const rest = aggregateSuffix(aggregateId, 'drop:');
  if (rest === null) return null;
  const separator = rest.indexOf('_');
  return separator > 0 ? rest.slice(0, separator) : null;
}

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
