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
import { isAppError } from '@/libs/error/error';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { isPubkyIdentifier, stripPubkyPrefix } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import {
  isSaleThread,
  listingContextKey,
  type ListingSide,
  type StoreThreadRoles,
  storeThreadRoles,
} from '@/pipes/commerce/store-seller-side';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import type { InboxAvailability, InboxPing, InboxPingRef } from '@/services/inbox/inbox.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import type { ChatConversationView, ChatMessageView, ChatSendParams } from './chat.types';

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
  static async fetchStoreThreadRoles(): Promise<StoreThreadRoles | null> {
    const me = useAuthStore.getState().currentUserPubky;
    if (!me || StoreSellerGate.canSellHere(me)) return null;
    if (this.storeThreadRolesRead?.pubky !== me) {
      const read: Promise<StoreThreadRoles> = this.readStoreThreadRoles(me).finally(() => {
        if (this.storeThreadRolesRead?.read === read) this.storeThreadRolesRead = null;
      });
      this.storeThreadRolesRead = { pubky: me, read };
    }
    return await this.storeThreadRolesRead.read;
  }

  /** One read per account at a time: every chat surface asks on mount. */
  private static storeThreadRolesRead: { pubky: string; read: Promise<StoreThreadRoles> } | null = null;

  private static async readStoreThreadRoles(me: string): Promise<StoreThreadRoles> {
    const signal = captureAuthScope();
    const [orders, conversations] = await Promise.all([
      CommerceApplication.getMarketplaceOrders(me),
      ChatApplication.getConversations(me, { includeEmpty: true }),
    ]);
    const contexts = new Map<string, { peer: string; listingId: string }>();
    for (const { peer_pubky: peer, last_context: context } of conversations) {
      if (context?.listingId)
        contexts.set(listingContextKey(peer, context.listingId), { peer, listingId: context.listingId });
    }
    const listingSides: Record<string, ListingSide> = {};
    const pending = [...contexts.entries()];
    for (let index = 0; index < pending.length; index += CHAT_FETCH_CONCURRENCY) {
      await Promise.all(
        pending.slice(index, index + CHAT_FETCH_CONCURRENCY).map(async ([key, { peer, listingId }]) => {
          const side = await this.listingSide(me, null, peer, listingId, { fetch: true });
          if (side) listingSides[key] = side;
        }),
      );
      signal.throwIfAborted();
    }
    const roles = storeThreadRoles(orders, me, listingSides);
    signal.throwIfAborted();
    useChatStore.getState().setStoreThreadRoles(roles);
    return roles;
  }

  /** The roles this tab has, read first when it has none; null when they cannot be read now. */
  private static async knownStoreThreadRoles(): Promise<StoreThreadRoles | null> {
    const known = useChatStore.getState().storeThreadRoles;
    if (known) return known;
    try {
      return await this.fetchStoreThreadRoles();
    } catch (error) {
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
    options: { fetch?: boolean } = {},
  ): Promise<boolean> {
    const listingId = thread.last_context?.listingId;
    const side = listingId ? await this.listingSide(me, roles, thread.peer_pubky, listingId, options) : null;
    return !isSaleThread(thread, roles, getStoreSeller(), side);
  }

  /**
   * Whose listing a context names: resolved in the roles, else cached here under the peer's or the
   * viewer's composite id, else (with `fetch`) read from the peer's and then the viewer's homeserver.
   * Null when none of these finds it.
   */
  private static async listingSide(
    me: string,
    roles: StoreThreadRoles | null,
    peer: string,
    listingId: string,
    { fetch = false }: { fetch?: boolean } = {},
  ): Promise<ListingSide | null> {
    const resolved = roles?.listingSides[listingContextKey(peer, listingId)];
    if (resolved) return resolved;
    const owners = [
      { owner: peer, side: 'peer' },
      { owner: me, side: 'viewer' },
    ] as const;
    for (const { owner, side } of owners) {
      if (await CommerceApplication.getListing(`${owner}:${listingId}`)) return side;
    }
    if (!fetch) return null;
    for (const { owner, side } of owners) {
      try {
        if (await CommerceApplication.getOrFetchListingIfFound(owner, listingId)) return side;
      } catch (error) {
        if (!isAppError(error)) Logger.warn('Could not read the listing a chat context names', { error });
      }
    }
    return null;
  }

  /**
   * Whether a write to a peer is a sale for a viewer who cannot sell here: the thread with that peer,
   * or the context the write names, is a sale thread.
   */
  private static async isSaleWrite(
    me: string,
    roles: StoreThreadRoles | null,
    peer: string,
    context: ChatContext | null | undefined,
  ): Promise<boolean> {
    const existing = await ChatApplication.getConversation(me, peer);
    const threads = [
      existing ?? { peer_pubky: peer, last_context: null },
      ...(context ? [{ peer_pubky: peer, last_context: context }] : []),
    ];
    for (const thread of threads) {
      if (!(await this.isBuyerThread(me, roles, thread, { fetch: true }))) return true;
    }
    return false;
  }

  /** Refuses a write in a sale thread, or about a sale, for a viewer who cannot sell here. */
  private static async assertNotSaleThread(me: string, peer: string, context: ChatContext | undefined): Promise<void> {
    if (await this.isSaleWrite(me, await this.knownStoreThreadRoles(), peer, context)) {
      StoreSellerGate.assertCanSellHere(me);
    }
  }

  /** For a viewer who cannot sell here, which queued messages may go out: none in a sale thread or about a sale. */
  private static async outboxSends(me: string): Promise<ChatOutboxSends | undefined> {
    if (StoreSellerGate.canSellHere(me)) return undefined;
    const roles = await this.knownStoreThreadRoles();
    return async ({ peer_pubky, context }) => !(await this.isSaleWrite(me, roles, peer_pubky, context));
  }

  // ------------------------------------------------------------------ writes

  static async commitOpenConversation(peerPubky: string, context?: ChatContext): Promise<ChatOpenResult> {
    const me = this.me();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const peer = this.normalizePeer(peerPubky);
    if (!sellsHere) await this.assertNotSaleThread(me, peer, context);
    return await ChatApplication.openConversation(me, peer, context, captureAuthScope());
  }

  /** Queues locally (the UI updates at once), then starts delivery. Returns the message row id. */
  static async commitSendMessage(params: ChatSendParams): Promise<string> {
    const me = this.me();
    const sellsHere = StoreSellerGate.canSellHere(me);
    const peer = this.normalizePeer(params.peerPubky);
    if (!sellsHere) await this.assertNotSaleThread(me, peer, params.context);
    const signal = captureAuthScope();
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
    const sends = await this.outboxSends(me);
    const signal = captureAuthScope();
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
      await ChatApplication.flushOutbox(me, signal, { sends: await this.outboxSends(me) });
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
    return await ChatApplication.syncConversation(this.me(), peerPubky, {
      reason,
      hintFile,
      signal: captureAuthScope(),
    });
  }

  static async fetchAllConversationUpdates(reason: ChatSyncReason): Promise<void> {
    const signal = captureAuthScope();
    const store = useChatStore.getState();
    store.setSyncStatus('syncing');
    try {
      await ChatApplication.syncAll(this.me(), reason, signal);
      signal.throwIfAborted();
      store.setSyncStatus('idle');
    } catch (error) {
      if (!signal.aborted) store.setSyncStatus('error');
      throw error;
    }
  }

  static async fetchRebuild(): Promise<void> {
    await ChatApplication.rebuildFromHomeserver(this.me(), captureAuthScope());
  }

  static async fetchSeededConversations(peers: string[]): Promise<void> {
    await ChatApplication.seedConversations(this.me(), peers, captureAuthScope());
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
        await ChatApplication.handlePing(me, ping, signal);
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
