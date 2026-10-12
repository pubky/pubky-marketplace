import { ChatApplication } from '@/application/chat/chat';
import type { ChatOpenResult, ChatSyncOutcome, ChatSyncReason } from '@/application/chat/chat.types';
import { CHAT_THREAD_PAGE } from '@/config/chat';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { isPubkyIdentifier, stripPubkyPrefix } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';
import { HomeserverService } from '@/services/homeserver/homeserver';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import type { InboxPing, InboxPingRef } from '@/services/inbox/inbox.types';
import { LocalChatService } from '@/services/local/chat/chat';
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

  static async getConversations(): Promise<ChatConversationView[]> {
    const me = this.me();
    const rows = await LocalChatService.listConversations(me);
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        unreadCount: await LocalChatService.countUnread(me, row.peer_pubky, row.last_read_at),
      })),
    );
  }

  static async getConversation(peerPubky: string): Promise<ChatConversationView | null> {
    const me = this.me();
    const row = await LocalChatService.getConversation(me, peerPubky);
    if (!row) return null;
    return { ...row, unreadCount: await LocalChatService.countUnread(me, peerPubky, row.last_read_at) };
  }

  static async getMessages(
    peerPubky: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChatMessageView[]> {
    return await LocalChatService.listMessages(this.me(), peerPubky, {
      before: options.before,
      limit: options.limit ?? CHAT_THREAD_PAGE,
    });
  }

  static async getMessageCount(peerPubky: string): Promise<number> {
    return await LocalChatService.countMessages(this.me(), peerPubky);
  }

  /** Conversations with unread messages, for the nav badge. */
  static async getUnreadConversationCount(): Promise<number> {
    const pubky = useAuthStore.getState().currentUserPubky;
    if (!pubky) return 0;
    return await LocalChatService.countUnreadConversations(pubky);
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
    return id;
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

  static async fetchInboxAvailability(): Promise<'disabled' | 'needs_grant' | 'ready'> {
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

  static async handleInboxPings(pings: InboxPing[]): Promise<void> {
    const me = this.me();
    for (const ping of pings) {
      try {
        await ChatApplication.handlePing(me, ping);
      } catch (error) {
        Logger.warn('Chat ping handling failed', { error });
      }
    }
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
    return await HomeserverService.subscribeHomeserverEventStream(params);
  }

  static async fetchPeerHomeserver(peerPubky: string): Promise<string | null> {
    const me = this.me();
    const state = await LocalChatService.getSyncState(me, peerPubky);
    if (state?.peer_homeserver) return state.peer_homeserver;
    const homeserver = await HomeserverService.resolveHomeserverOf(peerPubky);
    if (homeserver) await LocalChatService.updateSyncState(me, peerPubky, { peer_homeserver: homeserver });
    return homeserver;
  }

  static async commitPersistStreamCursor(peerPubky: string, cursor: string): Promise<void> {
    await LocalChatService.updateSyncState(this.me(), peerPubky, { sse_cursor: cursor });
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
