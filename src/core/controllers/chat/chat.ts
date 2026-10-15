import { ChatApplication } from '@/application/chat/chat';
import type { ChatOpenResult, ChatSyncOutcome, ChatSyncReason } from '@/application/chat/chat.types';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { CHAT_PING_MAX_HANDLING_ATTEMPTS } from '@/config/chat';
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
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import type { InboxAvailability, InboxPing, InboxPingRef } from '@/services/inbox/inbox.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import type { ChatConversationView, ChatMessageView, ChatSendParams } from './chat.types';

/**
 * UI and coordinator entry point for chat. `get*` reads Dexie, `fetch*`
 * touches homeservers or the inbox, `commit*` writes locally first and
 * syncs after. The signed-in pubky is implicit; every method throws when
 * nobody is signed in.
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
    const store = useChatStore.getState();
    try {
      const state = await ChatApplication.ensureIdentity(this.me());
      store.setIdentityState(state);
      return state;
    } catch (error) {
      store.setIdentityState('error');
      throw error;
    }
  }

  // ----------------------------------------------------------- local reads

  /** The inbox list; `includeEmpty` also returns threads that were only opened (the coordinator streams them). */
  static async getConversations(options: { includeEmpty?: boolean } = {}): Promise<ChatConversationView[]> {
    return await ChatApplication.getConversations(this.me(), options);
  }

  static async getConversation(peerPubky: string): Promise<ChatConversationView | null> {
    return await ChatApplication.getConversation(this.me(), peerPubky);
  }

  static async getMessages(
    peerPubky: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChatMessageView[]> {
    return await ChatApplication.getMessages(this.me(), peerPubky, options);
  }

  static async getMessageCount(peerPubky: string): Promise<number> {
    return await ChatApplication.getMessageCount(this.me(), peerPubky);
  }

  /** Conversations with unread messages, for the nav badge. */
  static async getUnreadConversationCount(): Promise<number> {
    const pubky = useAuthStore.getState().currentUserPubky;
    if (!pubky) return 0;
    return await ChatApplication.getUnreadConversationCount(pubky);
  }

  // ------------------------------------------------------------------ writes

  static async commitOpenConversation(peerPubky: string, context?: ChatContext): Promise<ChatOpenResult> {
    return await ChatApplication.openConversation(this.me(), this.normalizePeer(peerPubky), context);
  }

  /** Queues locally (the UI updates at once), then starts delivery. Returns the message row id. */
  static async commitSendMessage(params: ChatSendParams): Promise<string> {
    const me = this.me();
    const peer = this.normalizePeer(params.peerPubky);
    const id = await ChatApplication.queueMessage(me, { peer, body: params.body, context: params.context });
    void this.commitFlushOutbox();
    if (params.context) void this.followSellerOnIntent(me, peer, params.context);
    return id;
  }

  /**
   * A buyer's message about a listing or an order is intent, like a cart or a
   * checkout: follow the seller the same way (honours the privacy setting).
   * The seller is derived from the context, never assumed to be the peer, so
   * a seller replying about an order does not follow the buyer. Best effort;
   * the message never waits on it.
   */
  private static async followSellerOnIntent(me: string, peer: string, context: ChatContext): Promise<void> {
    try {
      const seller = await this.sellerForContext(me, peer, context);
      if (!seller) return;
      await UserApplication.ensureSellerFollow({ follower: me as Pubky, seller: seller as Pubky });
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

  static async commitRetryMessage(id: string): Promise<void> {
    await ChatApplication.retryMessage(this.me(), id);
    void this.commitFlushOutbox();
  }

  static async commitFlushOutbox(): Promise<void> {
    const pubky = useAuthStore.getState().currentUserPubky;
    if (!pubky) return;
    try {
      await ChatApplication.flushOutbox(pubky);
    } catch (error) {
      Logger.warn('Chat outbox flush failed; queued messages wait for the next attempt', { error });
    }
  }

  static async commitMarkRead(peerPubky: string, at: number = Date.now()): Promise<void> {
    const me = this.me();
    if (await ChatApplication.markRead(me, peerPubky, at)) {
      void ChatApplication.flushPrivState(me).catch((error: unknown) => {
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
    return await ChatApplication.syncConversation(this.me(), peerPubky, { reason, hintFile });
  }

  static async fetchAllConversationUpdates(reason: ChatSyncReason): Promise<void> {
    const store = useChatStore.getState();
    store.setSyncStatus('syncing');
    try {
      await ChatApplication.syncAll(this.me(), reason);
      store.setSyncStatus('idle');
    } catch (error) {
      store.setSyncStatus('error');
      throw error;
    }
  }

  static async fetchRebuild(): Promise<void> {
    await ChatApplication.rebuildFromHomeserver(this.me());
  }

  static async fetchSeededConversations(peers: string[]): Promise<void> {
    await ChatApplication.seedConversations(this.me(), peers);
  }

  static async fetchInboxAvailability(): Promise<InboxAvailability> {
    const store = useChatStore.getState();
    try {
      const availability = await ChatApplication.ensureInbox(this.me());
      store.setInboxStatus(availability);
      return availability;
    } catch (error) {
      store.setInboxStatus('unavailable');
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
    const handled: InboxPingRef[] = [];
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
        await ChatApplication.handlePing(me, ping);
        this.pingFailures.delete(key);
        handled.push(ref);
      } catch (error) {
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
    await ChatApplication.ackPings(this.me(), pings);
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
    return await ChatApplication.resolvePeerHomeserver(this.me(), peerPubky);
  }

  // ------------------------------------------------------------- teardown

  /** Sign-out: drop every chat row and the inbox session; resets the store. */
  static async clearForSignOut(pubky: string | null): Promise<void> {
    useChatStore.getState().reset();
    await ChatApplication.clearSession(pubky);
  }

  static clearSessionsOfOtherAccounts(keepPubky: string): void {
    ChatApplication.clearSessionsOfOtherAccounts(keepPubky);
  }
}
