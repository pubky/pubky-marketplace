import { parseListingAggregateId } from '@/libs/commerce/listing-aggregate';
import type { ChatContext } from '@/models/chat/chat.schema';

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

/** A notification row: recognized rows carry a subject; rows that failed the schema carry `kind`. */
type SubjectNotification = {
  kind?: string;
  type?: string;
  aggregateId?: string;
  moderationDecision?: { restriction: string; targetUri: string } | null;
};

const REVIEW_MODERATION_RESTRICTIONS: ReadonlySet<string> = new Set(['review_text_hidden', 'review_excluded']);

/** The order and offer ids and the moderated own-review URIs a notification list needs resolved. */
export function storeNotificationSubjects(notifications: readonly SubjectNotification[]): {
  orderIds: string[];
  offerIds: string[];
  reviewUris: string[];
} {
  const orderIds = new Set<string>();
  const offerIds = new Set<string>();
  const reviewUris = new Set<string>();
  for (const { kind, type, aggregateId, moderationDecision } of notifications) {
    if (kind !== undefined) continue;
    if (type === 'moderation_decision') {
      if (moderationDecision && REVIEW_MODERATION_RESTRICTIONS.has(moderationDecision.restriction)) {
        reviewUris.add(moderationDecision.targetUri);
      }
      continue;
    }
    const subject = subjectOfAggregate(aggregateId ?? '');
    if (subject.kind === 'order') orderIds.add(subject.id);
    if (subject.kind === 'offer') offerIds.add(subject.id);
  }
  return { orderIds: [...orderIds], offerIds: [...offerIds], reviewUris: [...reviewUris] };
}

/** What the controller resolved for {@link storeNotificationSubjects}; a missing or null entry is unknown. */
export type StoreNotificationRoles = {
  orderSellers: ReadonlyMap<string, string | null>;
  offerSellers: ReadonlyMap<string, string | null>;
  /** The role the viewer wrote each moderated review in, by review URI. */
  reviewRoles: ReadonlyMap<string, 'buyer' | 'seller' | null>;
};

/**
 * Marketplace notifications without those about the viewer's selling where it cannot sell. Kept:
 * notifications about a listing, drop, conversation, order or offer the viewer buys, checkouts and
 * payments, and moderation of a review the viewer wrote as a buyer. Dropped: everything about the
 * viewer's sales, moderation of its listings or shop, and whatever cannot be told apart: a row that
 * failed the schema, an unreadable moderation statement, an unknown aggregate, and an order, offer or
 * review the resolved roles do not name.
 */
export function withoutSalesNotificationsOutsideStoreSeller<T extends SubjectNotification>(
  notifications: T[],
  viewerPubky: string,
  storeSeller: string | null,
  roles: StoreNotificationRoles,
): T[] {
  if (canSellHere(viewerPubky, storeSeller)) return notifications;
  const sellerOf = (kind: 'order' | 'offer', id: string) =>
    (kind === 'order' ? roles.orderSellers : roles.offerSellers).get(id) ?? null;
  const isBuyerSide = ({ kind, type, aggregateId, moderationDecision }: T): boolean => {
    if (kind !== undefined) return false;
    if (type === 'moderation_decision') {
      if (!moderationDecision || !REVIEW_MODERATION_RESTRICTIONS.has(moderationDecision.restriction)) return false;
      return roles.reviewRoles.get(moderationDecision.targetUri) === 'buyer';
    }
    return !isSaleSubject(subjectOfAggregate(aggregateId ?? ''), viewerPubky, sellerOf);
  };
  return notifications.filter(isBuyerSide);
}

/** Whose listing a chat context names: the peer's (the viewer asks as a buyer) or the viewer's own. */
export type ListingSide = 'peer' | 'viewer';

/**
 * Which chat peers the viewer sold to or bought from, which order ids are its sales or purchases, and
 * whose listing each resolved listing context names, keyed by {@link listingContextKey}.
 */
export type StoreThreadRoles = {
  soldTo: readonly string[];
  boughtFrom: readonly string[];
  soldOrderIds: readonly string[];
  boughtOrderIds: readonly string[];
  listingSides: Readonly<Record<string, ListingSide>>;
};

export function listingContextKey(peerPubky: string, listingId: string): string {
  return `${peerPubky}:${listingId}`;
}

export function storeThreadRoles(
  orders: readonly { id: string; buyerPubky: string; sellerPubky: string }[],
  viewerPubky: string,
  listingSides: Readonly<Record<string, ListingSide>> = {},
): StoreThreadRoles {
  const sold = orders.filter(({ sellerPubky }) => sellerPubky === viewerPubky);
  const bought = orders.filter(({ buyerPubky }) => buyerPubky === viewerPubky);
  return {
    soldTo: sold.map(({ buyerPubky }) => buyerPubky),
    boughtFrom: bought.map(({ sellerPubky }) => sellerPubky),
    soldOrderIds: sold.map(({ id }) => id),
    boughtOrderIds: bought.map(({ id }) => id),
    listingSides,
  };
}

/**
 * Whether a chat thread is the viewer's sale, for a viewer who cannot sell in `storeSeller`'s store.
 * Before the roles are read, only the thread with the store seller is shown. After, a thread is per
 * peer, so it stays whenever anything makes it a purchase: the peer sold to the viewer, or its latest
 * context is an order the viewer bought or a listing of the peer. Otherwise it is a sale when the peer
 * bought from the viewer, or its latest context is an order the viewer sold or a listing of the
 * viewer's. Anything else stays: a plain thread, an order neither list names, and a listing context
 * `listingSide` could not resolve.
 */
export function isSaleThread(
  thread: { peer_pubky: string; last_context: ChatContext | null },
  roles: StoreThreadRoles | null,
  storeSeller: string | null,
  listingSide: ListingSide | null,
): boolean {
  const { peer_pubky: peer, last_context: context } = thread;
  if (roles === null) return peer !== storeSeller;
  const orderId = context?.orderId;
  const purchase =
    roles.boughtFrom.includes(peer) ||
    (orderId !== undefined && roles.boughtOrderIds.includes(orderId)) ||
    listingSide === 'peer';
  if (purchase) return false;
  return (
    roles.soldTo.includes(peer) ||
    (orderId !== undefined && roles.soldOrderIds.includes(orderId)) ||
    listingSide === 'viewer'
  );
}
