import { ChatApplication } from '@/application/chat/chat';
import type { ChatOpenResult, ChatOutboxSends, ChatSyncOutcome, ChatSyncReason } from '@/application/chat/chat.types';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { CHAT_FETCH_CONCURRENCY, CHAT_PING_MAX_HANDLING_ATTEMPTS } from '@/config/chat';
import { getStoreSeller } from '@/config/store-mode';
import { captureAuthScope } from '@/controllers/auth/auth-scope';
import { StoreSellerGate } from '@/controllers/store-seller-gate/store-seller-gate';
import { isChatPingSlot } from '@/libs/chat/paths';
import { isChatPing } from '@/libs/chat/schemas';
import { type AppError, isAppError } from '@/libs/error/error';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isAbortError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { isPubkyIdentifier, stripPubkyPrefix } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import {
  isSaleThread,
  listingContextKey,
  type ListingSide,
  mergeStoreThreadRoles,
  type StoreThreadRoles,
  storeThreadRoles,
} from '@/pipes/commerce/store-seller-side';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import type { InboxAvailability, InboxPing, InboxPingRef } from '@/services/inbox/inbox.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import type { ChatConversationView, ChatMessageView, ChatSendParams } from './chat.types';

type ChatOrder = { id: string; buyerPubky: string; sellerPubky: string };

/** The refusal produced when a store thread is closed to this viewer. */
export function isStoreThreadRefusal(error: unknown): error is AppError {
  return isAppError(error) && error.code === 'FORBIDDEN' && error.operation === 'assertCanSellHere';
}

/**
 * UI and coordinator entry point for chat. `get*` reads Dexie, `fetch*`
 * touches homeservers or the inbox, `commit*` writes locally first and
 * syncs after. The signed-in pubky is implicit; every method throws when
 * nobody is signed in. Every write path captures the auth scope on entry, so
 * work still running when that pubky signs out stops before its next write.
 * In a store the viewer does not sell in, its sale threads are hidden and
 * closed to writing, and its queued messages in them stay unsent
 * (`isSaleThread`); its buyer threads stay.
 */
export class ChatController {
  private constructor() {}

  private static me(): string {
    return useAuthStore.getState().selectCurrentUserPubky();
  }

  static normalizePeer(input: string): string {
    const peer = stripPubkyPrefix(input.trim());
    if (!isPubkyIdentifier(peer)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'That is not a valid Pubky.', {
        service: ErrorService.Local,
        operation: 'normalizePeer',
      });
    }
    return peer;
  }

  // ---------------------------------------------------------------- identity

  static async getOrFetchIdentity(): Promise<'ready' | 'needs_reauth'> {
    const signal = captureAuthScope();
    const store = useChatStore.getState();
    try {
      const state = await ChatApplication.ensureIdentity(this.me(), signal);
      signal.throwIfAborted();
      store.setIdentityState(state);
      return state;
    } catch (error) {
      if (!signal.aborted) store.setIdentityState('error');
      throw error;
    }
  }

  // ----------------------------------------------------------- local reads

  /** The inbox list; `includeEmpty` also returns threads that were only opened (the coordinator streams them). */
  static async getConversations(options: { includeEmpty?: boolean } = {}): Promise<ChatConversationView[]> {
    const me = this.me();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const conversations = await ChatApplication.getConversations(me, options);
    if (sellsHere) return conversations;
    const roles = useChatStore.getState().storeThreadRoles;
    const shown = await Promise.all(conversations.map((thread) => this.isBuyerThread(me, roles, thread)));
    return conversations.filter((_, index) => shown[index]);
  }

  static async getConversation(peerPubky: string): Promise<ChatConversationView | null> {
    const me = this.me();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const conversation = await ChatApplication.getConversation(me, peerPubky);
    if (sellsHere || conversation === null) return conversation;
    return (await this.isBuyerThread(me, useChatStore.getState().storeThreadRoles, conversation)) ? conversation : null;
  }

  static async getMessages(
    peerPubky: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChatMessageView[]> {
    const me = this.me();
    if (!(await this.showsThread(me, peerPubky))) return [];
    return await ChatApplication.getMessages(me, peerPubky, options);
  }

  static async getMessageCount(peerPubky: string): Promise<number> {
    const me = this.me();
    if (!(await this.showsThread(me, peerPubky))) return 0;
    return await ChatApplication.getMessageCount(me, peerPubky);
  }

  /** Conversations with unread messages, for the nav badge. */
  static async getUnreadConversationCount(): Promise<number> {
    const pubky = useAuthStore.getState().currentUserPubky;
    if (!pubky) return 0;
    if (StoreSellerGate.canSellHere(pubky)) return await ChatApplication.getUnreadConversationCount(pubky);
    const conversations = await this.getConversations({ includeEmpty: true });
    return conversations.filter(({ unreadCount }) => unreadCount > 0).length;
  }

  /**
   * In a store the viewer does not sell in, reads which chat peers it sold to or bought from and whose
   * listing each thread's listing context names, so its sale threads can be told apart. Nothing to
   * read for a viewer who sells here.
   */
  static async fetchStoreThreadRoles(signal: AbortSignal = captureAuthScope()): Promise<StoreThreadRoles | null> {
    const me = useAuthStore.getState().currentUserPubky;
    if (!me || StoreSellerGate.canSellHere(me)) return null;
    if (this.storeThreadRolesRead?.pubky !== me || this.storeThreadRolesRead.signal !== signal) {
      const read: Promise<StoreThreadRoles> = this.readStoreThreadRoles(me, signal).finally(() => {
        if (this.storeThreadRolesRead?.read === read) this.storeThreadRolesRead = null;
      });
      this.storeThreadRolesRead = { pubky: me, signal, read };
    }
    return await this.storeThreadRolesRead.read;
  }

  /** One read per account and auth scope at a time: every chat surface asks on mount. */
  private static storeThreadRolesRead: {
    pubky: string;
    signal: AbortSignal;
    read: Promise<StoreThreadRoles>;
  } | null = null;

  private static async readStoreThreadRoles(me: string, signal: AbortSignal): Promise<StoreThreadRoles> {
    const [orders, conversations] = await Promise.all([
      CommerceApplication.getMarketplaceOrders(me),
      ChatApplication.getConversations(me, { includeEmpty: true }),
    ]);
    signal.throwIfAborted();
    const knownOrderIds = new Set(orders.map(({ id }) => id));
    const missingOrderIds = new Set<string>();
    const contexts = new Map<string, { peer: string; listingId: string }>();
    for (const { peer_pubky: peer, last_context: context } of conversations) {
      if (context?.orderId && !knownOrderIds.has(context.orderId)) missingOrderIds.add(context.orderId);
      if (context?.listingId)
        contexts.set(listingContextKey(peer, context.listingId), { peer, listingId: context.listingId });
    }
    const { orders: resolvedOrders, failed: ordersFailed } = await this.resolveOrdersById(me, missingOrderIds, signal);
    let failed = ordersFailed;
    const listingSides: Record<string, ListingSide> = {};
    const pending = [...contexts.entries()];
    for (let index = 0; index < pending.length; index += CHAT_FETCH_CONCURRENCY) {
      await Promise.all(
        pending.slice(index, index + CHAT_FETCH_CONCURRENCY).map(async ([key, { peer, listingId }]) => {
          const side = await this.listingSide(me, null, peer, listingId, { fetch: true, signal });
          if (side === null) failed = true;
          else listingSides[key] = side;
        }),
      );
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    const roles = this.publishStoreThreadRoles(me, storeThreadRoles([...orders, ...resolvedOrders], me, listingSides));
    if (failed) {
      throw Err.server(
        ServerErrorCode.SERVICE_UNAVAILABLE,
        'Some chat contexts could not be placed; the roles read retries',
        {
          service: ErrorService.Marketplace,
          operation: 'readStoreThreadRoles',
        },
      );
    }
    return roles;
  }

  /** Adds what was learned to the roles this tab holds for the viewer, so a slower read never drops newer facts. */
  private static publishStoreThreadRoles(me: string, learned: StoreThreadRoles): StoreThreadRoles {
    const held = useChatStore.getState().storeThreadRoles;
    const roles = held?.viewer === me ? mergeStoreThreadRoles(held, learned) : learned;
    useChatStore.getState().setStoreThreadRoles(roles);
    return roles;
  }

  private static async resolveOrdersById(
    me: string,
    orderIds: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<{ orders: ChatOrder[]; failed: boolean }> {
    const resolved: ChatOrder[] = [];
    let failed = false;
    const pending = [...orderIds];
    for (let index = 0; index < pending.length; index += CHAT_FETCH_CONCURRENCY) {
      await Promise.all(
        pending.slice(index, index + CHAT_FETCH_CONCURRENCY).map(async (orderId) => {
          try {
            const parties = await CommerceApplication.getMarketplaceOrderParties(me, orderId);
            signal.throwIfAborted();
            if (parties === null) {
              failed = true;
              Logger.warn('Could not resolve the order a chat context names', { orderId });
              return;
            }
            resolved.push({ id: orderId, ...parties });
          } catch (error) {
            signal.throwIfAborted();
            if (isAbortError(error)) throw error;
            failed = true;
            Logger.warn('Could not read the order a chat context names', { orderId, error });
          }
        }),
      );
      signal.throwIfAborted();
    }
    return { orders: resolved, failed };
  }

  /** The roles this tab has, read first when it has none; null when they cannot be read now. */
  private static async knownStoreThreadRoles(me: string, signal: AbortSignal): Promise<StoreThreadRoles | null> {
    const known = useChatStore.getState().storeThreadRoles;
    if (known?.viewer === me) return known;
    try {
      return await this.fetchStoreThreadRoles(signal);
    } catch (error) {
      signal.throwIfAborted();
      if (isAbortError(error)) throw error;
      if (!isAppError(error)) Logger.warn('Could not read the store thread roles', { error });
      return null;
    }
  }

  /** Whether the thread with a peer is shown; one with no local row yet has nothing to hide. */
  private static async showsThread(me: string, peer: string): Promise<boolean> {
    if (StoreSellerGate.canSellHere(me)) return true;
    const conversation = await ChatApplication.getConversation(me, peer);
    return (
      conversation === null || (await this.isBuyerThread(me, useChatStore.getState().storeThreadRoles, conversation))
    );
  }

  private static async isBuyerThread(
    me: string,
    roles: StoreThreadRoles | null,
    thread: { peer_pubky: string; last_context: ChatContext | null },
  ): Promise<boolean> {
    const listingId = thread.last_context?.listingId;
    const side = listingId ? await this.listingSide(me, roles, thread.peer_pubky, listingId) : null;
    return !isSaleThread(thread, roles, getStoreSeller(), side);
  }

  /**
   * Whose listing a context names: resolved in the roles, else cached here under the peer's or the
   * viewer's composite id, else (with `fetch`) read from the peer's and then the viewer's homeserver.
   * `absent` requires both complete lookups; null leaves the context unresolved after a failed read.
   */
  private static async listingSide(
    me: string,
    roles: StoreThreadRoles | null,
    peer: string,
    listingId: string,
    { fetch = false, signal }: { fetch?: boolean; signal?: AbortSignal } = {},
  ): Promise<ListingSide | null> {
    const resolved = roles?.listingSides[listingContextKey(peer, listingId)];
    if (resolved) return resolved;
    signal?.throwIfAborted();
    const owners = [
      { owner: peer, side: 'peer' },
      { owner: me, side: 'viewer' },
    ] as const;
    for (const source of ['cache', 'homeserver'] as const) {
      if (source === 'homeserver' && !fetch) return null;
      for (const { owner, side } of owners) {
        try {
          const listing =
            source === 'cache'
              ? await CommerceApplication.getListing(`${owner}:${listingId}`)
              : await CommerceApplication.getOrFetchListingIfFound(owner, listingId);
          signal?.throwIfAborted();
          if (listing) return side;
        } catch (error) {
          signal?.throwIfAborted();
          if (isAbortError(error)) throw error;
          if (!isAppError(error)) Logger.warn('Could not read the listing a chat context names', { error });
          return null;
        }
      }
    }
    return 'absent';
  }

  /** A write's own sale or unresolved context is refused before peer-level purchase history applies. */
  private static async isSaleWrite(
    me: string,
    roles: StoreThreadRoles | null,
    peer: string,
    context: ChatContext | null | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    if (peer === getStoreSeller()) return false;
    if (roles === null) return true;
    const existing = await ChatApplication.getConversation(me, peer);
    signal.throwIfAborted();
    const contexts = [existing?.last_context, context];
    const missingOrderIds = new Set<string>();
    for (const candidate of contexts) {
      const orderId = candidate?.orderId;
      if (orderId && !roles.boughtOrderIds.includes(orderId) && !roles.soldOrderIds.includes(orderId)) {
        missingOrderIds.add(orderId);
      }
    }
    const { orders: resolvedOrders } = await this.resolveOrdersById(me, missingOrderIds, signal);
    let learned = storeThreadRoles(resolvedOrders, me, { ...roles.listingSides });
    let changed = resolvedOrders.length > 0;
    for (const candidate of contexts) {
      const listingId = candidate?.listingId;
      if (!listingId) continue;
      const key = listingContextKey(peer, listingId);
      if (learned.listingSides[key] !== undefined) continue;
      const side = await this.listingSide(me, mergeStoreThreadRoles(roles, learned), peer, listingId, {
        fetch: true,
        signal,
      });
      if (side !== null) {
        learned = { ...learned, listingSides: { ...learned.listingSides, [key]: side } };
        changed = true;
      }
    }
    signal.throwIfAborted();
    const held = useChatStore.getState().storeThreadRoles;
    const base = held?.viewer === me ? mergeStoreThreadRoles(roles, held) : roles;
    const merged = mergeStoreThreadRoles(base, learned);
    if (changed) useChatStore.getState().setStoreThreadRoles(merged);

    const sideOf = (candidate: ChatContext | null | undefined): ListingSide | null => {
      if (!candidate?.listingId) return null;
      return merged.listingSides[listingContextKey(peer, candidate.listingId)] ?? null;
    };
    if (context) {
      const orderId = context.orderId;
      const side = sideOf(context);
      const ownSale =
        (orderId !== undefined && merged.soldOrderIds.includes(orderId)) ||
        side === 'viewer' ||
        (orderId !== undefined && !merged.boughtOrderIds.includes(orderId) && !merged.soldOrderIds.includes(orderId)) ||
        (context.listingId !== undefined && side === null);
      if (ownSale) return true;
    }
    const thread = existing ?? { peer_pubky: peer, last_context: null };
    return isSaleThread(thread, merged, getStoreSeller(), sideOf(thread.last_context));
  }

  /** Refuses a write in a sale thread, or about a sale, for a viewer who cannot sell here. */
  private static async assertNotSaleThread(
    me: string,
    peer: string,
    context: ChatContext | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const sale = await this.isSaleWrite(me, await this.knownStoreThreadRoles(me, signal), peer, context, signal);
    signal.throwIfAborted();
    if (sale) StoreSellerGate.assertCanSellHere(me);
  }

  /** For a viewer who cannot sell here, which queued messages may go out: none in a sale thread or about a sale. */
  private static outboxSends(me: string, signal: AbortSignal): ChatOutboxSends | undefined {
    if (StoreSellerGate.canSellHere(me)) return undefined;
    // Read on the first message to judge, so a sync that sends nothing never waits for the roles.
    let roles: Promise<StoreThreadRoles | null> | undefined;
    return async ({ peer_pubky, context }) => {
      roles ??= this.knownStoreThreadRoles(me, signal);
      const sale = await this.isSaleWrite(me, await roles, peer_pubky, context, signal);
      signal.throwIfAborted();
      return !sale;
    };
  }

  // ------------------------------------------------------------------ writes

  static async commitOpenConversation(peerPubky: string, context?: ChatContext): Promise<ChatOpenResult> {
    const me = this.me();
    const signal = captureAuthScope();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const peer = this.normalizePeer(peerPubky);
    if (!sellsHere) await this.assertNotSaleThread(me, peer, context, signal);
    signal.throwIfAborted();
    return await ChatApplication.openConversation(me, peer, context, signal);
  }

  /** Queues locally (the UI updates at once), then starts delivery. Returns the message row id. */
  static async commitSendMessage(params: ChatSendParams): Promise<string> {
    const me = this.me();
    const signal = captureAuthScope();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const peer = this.normalizePeer(params.peerPubky);
    if (!sellsHere) await this.assertNotSaleThread(me, peer, params.context, signal);
    signal.throwIfAborted();
    const id = await ChatApplication.queueMessage(me, { peer, body: params.body, context: params.context }, signal);
    void this.flushOutboxFor(me, signal);
    if (params.context) void this.followSellerOnIntent(me, peer, params.context, signal);
    return id;
  }

  /**
   * A buyer's message about a listing or an order is intent, like a cart or a
   * checkout: follow the seller the same way (honours the privacy setting).
   * The seller is derived from the context, never assumed to be the peer, so
   * a seller replying about an order does not follow the buyer. Best effort;
   * the message never waits on it.
   */
  private static async followSellerOnIntent(
    me: string,
    peer: string,
    context: ChatContext,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const seller = await this.sellerForContext(me, peer, context);
      if (!seller || signal.aborted) return;
      await UserApplication.ensureSellerFollow({ follower: me as Pubky, seller: seller as Pubky, signal });
    } catch (error) {
      if (!isAppError(error)) Logger.warn('Could not follow the seller for this message', { error });
    }
  }

  /** The seller the context names, when the current user is its buyer side and the peer is that seller. */
  private static async sellerForContext(me: string, peer: string, context: ChatContext): Promise<string | null> {
    if (context.orderId) {
      const orders = await CommerceApplication.getMarketplaceOrders(me);
      const order = orders.find((candidate) => candidate.id === context.orderId);
      return order && order.buyerPubky === me && order.sellerPubky === peer ? peer : null;
    }
    if (context.listingId) {
      // A listing is cached under its seller's composite id; the peer is the seller only if it is theirs.
      const listing = await CommerceApplication.getListing(`${peer}:${context.listingId}`);
      return listing ? peer : null;
    }
    return null;
  }

  /** Puts a failed message back in the queue; in a store, one in a sale thread or about a sale stays failed. */
  static async commitRetryMessage(id: string): Promise<void> {
    const me = this.me();
    const signal = captureAuthScope();
    const sends = this.outboxSends(me, signal);
    signal.throwIfAborted();
    await ChatApplication.retryMessage(me, id, signal, { sends });
    void this.flushOutboxFor(me, signal);
  }

  static async commitFlushOutbox(): Promise<void> {
    const pubky = useAuthStore.getState().currentUserPubky;
    if (!pubky) return;
    await this.flushOutboxFor(pubky, captureAuthScope());
  }

  /**
   * Flushes under the caller's scope, so a flush that follows a send or retry ends with that identity.
   * In a store, a message queued in a sale thread or about a sale stays queued.
   */
  private static async flushOutboxFor(me: string, signal: AbortSignal): Promise<void> {
    try {
      await ChatApplication.flushOutbox(me, signal, { sends: this.outboxSends(me, signal) });
    } catch (error) {
      if (!signal.aborted) {
        Logger.warn('Chat outbox flush failed; queued messages wait for the next attempt', { error });
      }
    }
  }

  static async commitMarkRead(peerPubky: string, at: number = Date.now()): Promise<void> {
    const me = this.me();
    const signal = captureAuthScope();
    if (await ChatApplication.markRead(me, peerPubky, at, signal)) {
      void ChatApplication.flushPrivState(me, signal).catch((error: unknown) => {
        Logger.warn('Chat read state write failed; it retries on the next sync', { error });
      });
    }
  }

  // ------------------------------------------------------------- network

  static async fetchConversationUpdates(
    peerPubky: string,
    reason: ChatSyncReason,
    hintFile?: string,
  ): Promise<ChatSyncOutcome> {
    const me = this.me();
    const signal = captureAuthScope();
    const sends = this.outboxSends(me, signal);
    return await ChatApplication.syncConversation(me, peerPubky, {
      reason,
      hintFile,
      signal,
      sends,
    });
  }

  static async fetchAllConversationUpdates(reason: ChatSyncReason): Promise<void> {
    const me = this.me();
    const signal = captureAuthScope();
    const store = useChatStore.getState();
    store.setSyncStatus('syncing');
    try {
      const sends = this.outboxSends(me, signal);
      await ChatApplication.syncAll(me, reason, signal, { sends });
      signal.throwIfAborted();
      store.setSyncStatus('idle');
    } catch (error) {
      if (!signal.aborted) store.setSyncStatus('error');
      throw error;
    }
  }

  static async fetchRebuild(): Promise<void> {
    const me = this.me();
    const signal = captureAuthScope();
    const sends = this.outboxSends(me, signal);
    await ChatApplication.rebuildFromHomeserver(me, signal, { sends });
  }

  static async fetchSeededConversations(peers: string[]): Promise<void> {
    const me = this.me();
    const signal = captureAuthScope();
    const sends = this.outboxSends(me, signal);
    await ChatApplication.seedConversations(me, peers, signal, { sends });
  }

  static async fetchInboxAvailability(): Promise<InboxAvailability> {
    const signal = captureAuthScope();
    const store = useChatStore.getState();
    try {
      const availability = await ChatApplication.ensureInbox(this.me(), signal);
      signal.throwIfAborted();
      store.setInboxStatus(availability);
      return availability;
    } catch (error) {
      if (!signal.aborted) store.setInboxStatus('unavailable');
      throw error;
    }
  }

  static async fetchInboxPings(signal?: AbortSignal): Promise<InboxPing[]> {
    return await ChatApplication.waitForPings(this.me(), signal);
  }

  /** Failed handling attempts per ping (sender, slot, revision), so a ping that keeps failing is dropped. */
  private static pingFailures = new Map<string, number>();

  /**
   * Handles the pings in our slot family and returns the ones to ack. The
   * inbox returns the oldest pending pings first and an ack applies to the
   * whole account, so: another app's slot is never touched; a chat slot with
   * an unreadable payload is acked (dropped) at once; a chat ping whose
   * handling throws is left for the next poll and dropped after
   * CHAT_PING_MAX_HANDLING_ATTEMPTS, so neither can sit at the front of the
   * poll window forever and hide newer pings.
   */
  static async handleInboxPings(pings: InboxPing[]): Promise<InboxPingRef[]> {
    const me = this.me();
    const signal = captureAuthScope();
    const handled: InboxPingRef[] = [];
    const sends = this.outboxSends(me, signal);
    // Without a ready identity nothing can be handled; acking would discard first contacts.
    if ((await this.getOrFetchIdentity()) !== 'ready') return handled;
    for (const ping of pings) {
      if (!isChatPingSlot(ping.slot)) continue;
      const ref: InboxPingRef = { sender: ping.sender, slot: ping.slot, revision: ping.revision };
      if (!isChatPing(ping)) {
        Logger.warn('Chat ping with an unreadable payload dropped', { slot: ping.slot });
        handled.push(ref);
        continue;
      }
      const key = `${ping.sender}|${ping.slot}|${ping.revision}`;
      try {
        await ChatApplication.handlePing(me, ping, signal, { sends });
        this.pingFailures.delete(key);
        handled.push(ref);
      } catch (error) {
        if (signal.aborted) throw error;
        const attempts = (this.pingFailures.get(key) ?? 0) + 1;
        if (attempts >= CHAT_PING_MAX_HANDLING_ATTEMPTS) {
          this.pingFailures.delete(key);
          handled.push(ref);
          Logger.warn('Chat ping dropped after repeated handling failures', { attempts, error });
        } else {
          this.pingFailures.set(key, attempts);
          Logger.warn('Chat ping handling failed; left on the inbox for the next poll', { attempts, error });
        }
      }
    }
    // Bounded: entries leave on success or drop; a flood of distinct failing pings must not grow it forever.
    if (this.pingFailures.size > 1_000) this.pingFailures.clear();
    return handled;
  }

  static async commitAckInboxPings(pings: InboxPingRef[]): Promise<void> {
    await ChatApplication.ackPings(this.me(), pings, captureAuthScope());
  }

  /** A live event stream over one homeserver for the given peers and conversation folders. */
  static async subscribeChatEventStream(params: {
    homeserver: string;
    users: Array<[string, string | null]>;
    pathPrefixes: string[];
  }): Promise<ReadableStream<THomeserverResourceEvent>> {
    return await ChatApplication.subscribeEventStream(params);
  }

  static async fetchPeerHomeserver(peerPubky: string): Promise<string | null> {
    return await ChatApplication.resolvePeerHomeserver(this.me(), peerPubky, captureAuthScope());
  }

  // ------------------------------------------------------------- teardown

  /** Sign-out: drop every chat row and the inbox session; resets the store. */
  static async clearForSignOut(pubky: string | null): Promise<void> {
    useChatStore.getState().reset();
    await ChatApplication.clearSession(pubky);
  }

  /** Account switch or a cleanup that keeps one account: this tab's view state is stale either way. */
  static clearSessionsOfOtherAccounts(keepPubky: string): void {
    useChatStore.getState().reset();
    ChatApplication.clearSessionsOfOtherAccounts(keepPubky);
  }
}
