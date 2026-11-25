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

/** Whose listing a chat context names, or that neither side owns it after a complete lookup. */
export type ListingSide = 'peer' | 'viewer' | 'absent';

/** A looked-up listing context: its side, or `unresolved` while a lookup of it failed, which reads as a sale. */
export type ListingSideRecord = ListingSide | 'unresolved';

/** The counterparty recorded for an order two reads placed with different counterparties; it matches no peer. */
export const CONFLICTING_COUNTERPARTY = '';

/**
 * Which chat peers the viewer sold to or bought from, the buyer of each order it sold and the seller of
 * each order it bought (by order id), and whose listing each resolved listing context names, keyed by
 * {@link listingContextKey}.
 */
export type StoreThreadRoles = {
  viewer: string;
  soldTo: readonly string[];
  boughtFrom: readonly string[];
  soldOrders: Readonly<Record<string, string>>;
  boughtOrders: Readonly<Record<string, string>>;
  listingSides: Readonly<Record<string, ListingSideRecord>>;
};

export function listingContextKey(peerPubky: string, listingId: string): string {
  return `${peerPubky}:${listingId}`;
}

export function storeThreadRoles(
  orders: readonly { id: string; buyerPubky: string; sellerPubky: string }[],
  viewerPubky: string,
  listingSides: Readonly<Record<string, ListingSideRecord>> = {},
): StoreThreadRoles {
  const sold = orders.filter(({ sellerPubky }) => sellerPubky === viewerPubky);
  const bought = orders.filter(({ buyerPubky }) => buyerPubky === viewerPubky);
  return {
    viewer: viewerPubky,
    soldTo: sold.map(({ buyerPubky }) => buyerPubky),
    boughtFrom: bought.map(({ sellerPubky }) => sellerPubky),
    soldOrders: Object.fromEntries(sold.map(({ id, buyerPubky }) => [id, buyerPubky])),
    boughtOrders: Object.fromEntries(bought.map(({ id, sellerPubky }) => [id, sellerPubky])),
    listingSides,
  };
}

/**
 * Everything either set of roles knows about one viewer; roles of another viewer are never mixed in.
 * A listing the viewer owns stays the viewer's: a later read never turns it into the peer's or absent, and
 * a failed lookup never replaces a resolved one. An order two reads placed with different counterparties
 * is recorded with {@link CONFLICTING_COUNTERPARTY}, so it is a purchase in no thread.
 */
export function mergeStoreThreadRoles(base: StoreThreadRoles, addition: StoreThreadRoles): StoreThreadRoles {
  if (base.viewer !== addition.viewer) return addition;
  const union = (first: readonly string[], second: readonly string[]) => [...new Set([...first, ...second])];
  const listingSides: Record<string, ListingSideRecord> = { ...base.listingSides };
  for (const [key, side] of Object.entries(addition.listingSides)) {
    const held = listingSides[key];
    if (held === 'viewer' || (side === 'unresolved' && held !== undefined)) continue;
    listingSides[key] = side;
  }
  const counterparties = (first: Readonly<Record<string, string>>, second: Readonly<Record<string, string>>) => {
    const merged = new Map(Object.entries(first));
    for (const [id, party] of Object.entries(second)) {
      merged.set(id, merged.has(id) && merged.get(id) !== party ? CONFLICTING_COUNTERPARTY : party);
    }
    return Object.fromEntries(merged);
  };
  return {
    viewer: base.viewer,
    soldTo: union(base.soldTo, addition.soldTo),
    boughtFrom: union(base.boughtFrom, addition.boughtFrom),
    soldOrders: { ...base.soldOrders, ...addition.soldOrders },
    boughtOrders: counterparties(base.boughtOrders, addition.boughtOrders),
    listingSides,
  };
}

/** What a thread's latest context says about the viewer's role with the peer. */
export type ContextRole = 'sale' | 'purchase' | 'peer';

/**
 * Reads a context against the roles. `sale`: it names an order the viewer sold or a listing it owns, or
 * it cannot be placed with this peer: an order in neither list, an order the viewer bought from someone
 * other than the peer, or a listing whose lookup failed. `purchase`: it names an order the viewer
 * bought from the peer or a listing of the peer, and nothing that makes it a sale. `peer`: it places
 * nothing, and the thread follows the peer's history. The sale reading wins over the purchase one.
 */
export function contextRole(
  roles: StoreThreadRoles,
  peer: string,
  context: { orderId?: string; listingId?: string } | null | undefined,
  listingSide: ListingSide | null,
): ContextRole {
  const orderId = context?.orderId;
  const sold = orderId !== undefined && Object.hasOwn(roles.soldOrders, orderId);
  const boughtFromPeer =
    orderId !== undefined && Object.hasOwn(roles.boughtOrders, orderId) && roles.boughtOrders[orderId] === peer;
  const orderPlaced = orderId === undefined || sold || boughtFromPeer;
  const listingPlaced = context?.listingId === undefined || listingSide !== null;
  if (sold || listingSide === 'viewer' || !orderPlaced || !listingPlaced) return 'sale';
  return boughtFromPeer || listingSide === 'peer' ? 'purchase' : 'peer';
}

/**
 * Whether a chat thread is the viewer's sale, for a viewer who cannot sell in `storeSeller`'s store.
 * The store seller's own thread always stays. Before the roles are read, nothing else is shown. The
 * latest context decides first ({@link contextRole}): the viewer's sale, or a context that cannot be
 * placed with this peer, makes it a sale even when the same context also names an order the viewer
 * bought from the peer or a listing of the peer, and whatever else the viewer bought from that peer.
 * Otherwise a context that is an order the viewer bought from the peer or a listing of the peer keeps
 * the thread. A context that places nothing, a plain thread or a listing lookup that completed without
 * finding either owner's listing, follows the peer: the thread stays when the peer sold to the viewer,
 * and is a sale when the peer bought from the viewer.
 */
export function isSaleThread(
  thread: { peer_pubky: string; last_context: ChatContext | null },
  roles: StoreThreadRoles | null,
  storeSeller: string | null,
  listingSide: ListingSide | null,
): boolean {
  const { peer_pubky: peer, last_context: context } = thread;
  if (peer === storeSeller) return false;
  if (roles === null) return true;
  const role = contextRole(roles, peer, context, listingSide);
  if (role === 'sale') return true;
  if (role === 'purchase') return false;
  if (roles.boughtFrom.includes(peer)) return false;
  return roles.soldTo.includes(peer);
}
