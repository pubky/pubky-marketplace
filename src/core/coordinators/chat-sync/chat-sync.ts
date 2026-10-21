import { liveQuery, type Subscription } from 'dexie';
import { AUTH_ROUTES } from '@/app/routes';
import {
  CHAT_DISCOVERY_INTERVAL_MS,
  CHAT_EVENT_DEBOUNCE_MS,
  CHAT_INBOX_FOREIGN_PAUSE_MS,
  CHAT_INBOX_RETRY_MS,
  CHAT_RECONCILE_HIDDEN_MS,
  CHAT_RECONCILE_VISIBLE_MS,
  CHAT_SSE_MAX_CONVERSATIONS,
  CHAT_SSE_MAX_USERS_PER_STREAM,
  CHAT_SSE_RECONNECT_BACKOFF_MS,
} from '@/config/chat';
import { getCommerceAdapterMode, isTransactionalCommerceMode } from '@/config/commerce';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { routeToRegex } from '@/coordinators/base/coordinators.utils';
import { CHAT_LOG_PUBLIC_KEY, chatFolderPath, parseChatEventPath } from '@/libs/chat/paths';
import { RetryBackoff } from '@/libs/chat/retry-backoff';
import { CHAT_LOCKS, holdLeadership, type LeadershipHandle } from '@/libs/chat/web-locks';
import { Logger } from '@/libs/logger/logger';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import type { InboxAvailability } from '@/services/inbox/inbox.types';
import { signedInUserChanged } from '@/stores/auth/auth.change';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import type { ChatSyncCoordinatorState } from './chat-sync.types';

type StreamTarget = { homeserver: string; users: Array<[string, string | null]>; folders: string[] };

const streamSignature = (target: StreamTarget): string =>
  JSON.stringify([target.users.map(([peer]) => peer), target.folders]);

/**
 * Keeps chat fresh in the background.
 *
 * Every tab: provisions the identity and rebuilds the cache on sign-in,
 * flushes the outbox when the browser comes back online. The LEADER tab
 * (one per account, elected through a Web Lock) additionally runs three
 * loops: the inbox long-poll (pings), live homeserver event streams for the
 * most recent conversations, and a reconciliation pass that lists every
 * known folder on a cadence and discovers order counterparties.
 *
 * Followers render everything the leader writes through Dexie live queries.
 * Nothing here is the source of truth: every loop ends in an idempotent sync.
 */
export class ChatSyncCoordinator {
  private static instance: ChatSyncCoordinator | null = null;

  private readonly disabledRoutes = [
    routeToRegex('/onboarding'),
    routeToRegex(AUTH_ROUTES.LOGOUT),
    routeToRegex(AUTH_ROUTES.SIGN_IN),
  ];

  private state: ChatSyncCoordinatorState = {
    isStarted: false,
    currentRoute: '',
    isPageVisible: true,
    isLeader: false,
  };

  private generation = 0;
  private leadership: LeadershipHandle | null = null;
  private authStoreUnsubscribe: (() => void) | null = null;
  private visibilityChangeHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private focusHandler: (() => void) | null = null;

  private inboxAbort: AbortController | null = null;
  private conversationsSubscription: Subscription | null = null;
  private streamReaders = new Map<string, ReadableStreamDefaultReader<THomeserverResourceEvent>>();
  private streamTargets = new Map<string, string>();
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  private discoveryAt = 0;
  private eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly backoff = new RetryBackoff<null>({ baseMs: 1_000, maxMs: 60_000 });
  private activeOwner: string | null = null;

  private constructor() {
    this.setupListeners();
  }

  public static getInstance(): ChatSyncCoordinator {
    ChatSyncCoordinator.instance ??= new ChatSyncCoordinator();
    return ChatSyncCoordinator.instance;
  }

  public static resetInstance(): void {
    if (ChatSyncCoordinator.instance) {
      ChatSyncCoordinator.instance.destroy();
      ChatSyncCoordinator.instance = null;
    }
  }

  public start(): void {
    this.state.isStarted = true;
    this.evaluate();
    Logger.debug('ChatSyncCoordinator started');
  }

  public stop(): void {
    this.state.isStarted = false;
    this.teardown();
    Logger.debug('ChatSyncCoordinator stopped');
  }

  public setRoute(route: string): void {
    if (this.state.currentRoute === route) return;
    const hadPreviousRoute = this.state.currentRoute !== '';
    const prevDisabled = hadPreviousRoute && this.isRouteDisabled(this.state.currentRoute);
    const nextDisabled = this.isRouteDisabled(route);
    this.state.currentRoute = route;
    if (!hadPreviousRoute || prevDisabled !== nextDisabled) this.evaluate();
  }

  public destroy(): void {
    this.stop();
    this.removeListeners();
  }

  /** The leader's reconciliation, on demand (focus, online, a page that wants fresh data). */
  public requestReconcile(): void {
    if (!this.state.isLeader) return;
    this.scheduleReconcile(0);
  }

  // ------------------------------------------------------------- lifecycle

  private setupListeners(): void {
    this.authStoreUnsubscribe = useAuthStore.subscribe((state, prevState) => {
      if (signedInUserChanged(state, prevState)) this.evaluate();
    });
    if (typeof document !== 'undefined') {
      this.state.isPageVisible = document.visibilityState === 'visible';
      this.visibilityChangeHandler = () => {
        const visible = document.visibilityState === 'visible';
        if (this.state.isPageVisible === visible) return;
        this.state.isPageVisible = visible;
        if (visible) {
          void ChatController.commitFlushOutbox();
          this.requestReconcile();
        } else if (this.state.isLeader) {
          this.scheduleReconcile(CHAT_RECONCILE_HIDDEN_MS);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }
    if (typeof window !== 'undefined') {
      this.onlineHandler = () => {
        void ChatController.commitFlushOutbox();
        this.requestReconcile();
      };
      this.focusHandler = () => this.requestReconcile();
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('focus', this.focusHandler);
    }
  }

  private removeListeners(): void {
    this.authStoreUnsubscribe?.();
    this.authStoreUnsubscribe = null;
    if (typeof document !== 'undefined' && this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler);
      if (this.focusHandler) window.removeEventListener('focus', this.focusHandler);
      this.onlineHandler = null;
      this.focusHandler = null;
    }
  }

  private isRouteDisabled(route: string): boolean {
    return this.disabledRoutes.some((pattern) => pattern.test(route));
  }

  private owner(): string | null {
    const auth = useAuthStore.getState();
    if (!auth.selectIsAuthenticated()) return null;
    return auth.currentUserPubky ?? null;
  }

  private shouldRun(): boolean {
    return this.state.isStarted && this.owner() !== null && !this.isRouteDisabled(this.state.currentRoute);
  }

  private evaluate(): void {
    const owner = this.shouldRun() ? this.owner() : null;
    if (owner === this.activeOwner && (owner === null || this.leadership)) return;
    this.teardown();
    if (!owner) return;
    this.activeOwner = owner;
    this.generation += 1;
    const generation = this.generation;
    void this.onSignedIn(owner, generation);
    this.leadership = holdLeadership(CHAT_LOCKS.leader(owner), {
      onAcquired: () => {
        if (generation !== this.generation) return;
        this.state.isLeader = true;
        useChatStore.getState().setLeaderTab(true);
        void this.runLeader(owner, generation);
      },
      onReleased: () => {
        this.state.isLeader = false;
        useChatStore.getState().setLeaderTab(false);
      },
    });
  }

  private teardown(): void {
    this.generation += 1;
    this.activeOwner = null;
    this.leadership?.release();
    this.leadership = null;
    this.state.isLeader = false;
    useChatStore.getState().setLeaderTab(false);
    this.inboxAbort?.abort();
    this.inboxAbort = null;
    this.conversationsSubscription?.unsubscribe();
    this.conversationsSubscription = null;
    for (const reader of this.streamReaders.values()) void reader.cancel().catch(() => {});
    this.streamReaders.clear();
    this.streamTargets.clear();
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    for (const timer of this.eventTimers.values()) clearTimeout(timer);
    this.eventTimers.clear();
    this.backoff.clear();
  }

  /** Every tab: identity provisioning and the cache rebuild (one tab does the rebuild). */
  private async onSignedIn(owner: string, generation: number): Promise<void> {
    try {
      const identity = await ChatController.getOrFetchIdentity();
      if (generation !== this.generation || identity !== 'ready') return;
      // The rebuild itself runs in one tab (application-level lock); a second
      // tab's call returns at once.
      await ChatController.fetchRebuild();
      if (generation !== this.generation) return;
      await ChatController.commitFlushOutbox();
    } catch (error) {
      Logger.warn('Chat sign-in setup failed; retrying on the next reconcile', { error });
    }
  }

  // ---------------------------------------------------------------- leader

  private async runLeader(owner: string, generation: number): Promise<void> {
    this.scheduleReconcile(0);
    void this.runInboxLoop(owner, generation);
    // A conversation opened or created in any tab gets a live stream at once,
    // not on the next reconcile pass.
    this.conversationsSubscription?.unsubscribe();
    this.conversationsSubscription = liveQuery(() => ChatController.getConversations()).subscribe({
      next: () => {
        if (generation !== this.generation || !this.state.isLeader) return;
        void this.refreshStreams(owner, generation);
      },
      error: (error: unknown) => Logger.debug('Chat conversation watch failed', { error }),
    });
  }

  private scheduleReconcile(delayMs: number): void {
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.reconcile();
    }, delayMs);
  }

  private async reconcile(): Promise<void> {
    const generation = this.generation;
    const owner = this.activeOwner;
    if (!owner || !this.state.isLeader) return;
    try {
      if (Date.now() - this.discoveryAt > CHAT_DISCOVERY_INTERVAL_MS) {
        this.discoveryAt = Date.now();
        await this.discoverCounterparties(owner);
      }
      await ChatController.commitFlushOutbox();
      await ChatController.fetchAllConversationUpdates('reconcile');
      if (generation !== this.generation) return;
      await this.refreshStreams(owner, generation);
    } catch (error) {
      Logger.warn('Chat reconcile pass failed', { error });
    } finally {
      if (generation === this.generation && this.state.isLeader) {
        this.scheduleReconcile(this.state.isPageVisible ? CHAT_RECONCILE_VISIBLE_MS : CHAT_RECONCILE_HIDDEN_MS);
      }
    }
  }

  /** Order counterparties already know each other: they become conversations once either side writes. */
  private async discoverCounterparties(owner: string): Promise<void> {
    // Orders live in the transaction service; without one there is nothing to discover.
    if (!isTransactionalCommerceMode(getCommerceAdapterMode())) return;
    try {
      const orders = await CommerceController.getMarketplaceOrders();
      const peers = new Set<string>();
      for (const order of orders) {
        const peer = order.buyerPubky === owner ? order.sellerPubky : order.buyerPubky;
        if (peer && peer !== owner) peers.add(peer);
      }
      if (peers.size > 0) await ChatController.fetchSeededConversations([...peers]);
    } catch (error) {
      Logger.debug('Chat counterparty discovery skipped', { error });
    }
  }

  // ----------------------------------------------------------------- inbox

  private async runInboxLoop(owner: string, generation: number): Promise<void> {
    while (generation === this.generation && this.state.isLeader) {
      // A session without the chat scopes cannot handle a ping, and an ack is
      // account-wide: leave the pings on the inbox until the identity is ready
      // (re-approval, or a retry) instead of polling and dropping them.
      if (!(await this.isIdentityReady())) {
        await this.waitForIdentity(generation);
        continue;
      }
      let availability: InboxAvailability;
      try {
        availability = await ChatController.fetchInboxAvailability();
      } catch (error) {
        Logger.warn('Chat inbox session failed', { error });
        await this.sleep(this.backoff.fail('inbox', null), generation);
        continue;
      }
      if (generation !== this.generation) return;
      if (availability !== 'ready') {
        useChatStore.getState().setInboxStatus(availability);
        await this.sleep(CHAT_INBOX_RETRY_MS, generation);
        continue;
      }
      this.inboxAbort = new AbortController();
      try {
        const pings = await ChatController.fetchInboxPings(this.inboxAbort.signal);
        if (generation !== this.generation) return;
        this.backoff.succeed('inbox');
        useChatStore.getState().setInboxStatus('ready');
        if (pings.length > 0) {
          const handled = await ChatController.handleInboxPings(pings);
          if (handled.length > 0) {
            await ChatController.commitAckInboxPings(handled);
            void this.refreshStreams(owner, generation);
          } else {
            // Nothing of ours: the pending pings belong to another app or their handling
            // failed. They stay on the inbox, so pause before asking again instead of spinning.
            await this.sleep(CHAT_INBOX_FOREIGN_PAUSE_MS, generation);
          }
        }
      } catch (error) {
        if (generation !== this.generation) return;
        const delay = this.backoff.fail('inbox', null);
        if (delay > 30_000) useChatStore.getState().setInboxStatus('unavailable');
        Logger.warn('Chat inbox poll failed', { error });
        await this.sleep(delay, generation);
      } finally {
        this.inboxAbort = null;
      }
    }
  }

  // --------------------------------------------------------------- streams

  /** One live stream per homeserver for the most recent conversations; restarts only what changed. */
  private async refreshStreams(owner: string, generation: number): Promise<void> {
    const conversations = (await ChatController.getConversations({ includeEmpty: true }))
      .filter((row) => row.peer_state === 'ready' && row.folder_id)
      .slice(0, CHAT_SSE_MAX_CONVERSATIONS);
    const targets = new Map<string, StreamTarget>();
    for (const row of conversations) {
      let homeserver: string | null;
      try {
        homeserver = await ChatController.fetchPeerHomeserver(row.peer_pubky);
      } catch {
        homeserver = null;
      }
      if (!homeserver || generation !== this.generation) continue;
      const target = targets.get(homeserver) ?? { homeserver, users: [], folders: [] };
      if (target.users.length >= CHAT_SSE_MAX_USERS_PER_STREAM) continue;
      target.users.push([row.peer_pubky, null]);
      target.folders.push(row.folder_id!);
      targets.set(homeserver, target);
    }
    for (const [homeserver, target] of targets) {
      const signature = streamSignature(target);
      if (this.streamTargets.get(homeserver) === signature) continue;
      this.streamTargets.set(homeserver, signature);
      const previous = this.streamReaders.get(homeserver);
      if (previous) void previous.cancel().catch(() => {});
      this.streamReaders.delete(homeserver);
      void this.runStream(owner, target, generation);
    }
    for (const homeserver of [...this.streamReaders.keys()]) {
      if (!targets.has(homeserver)) {
        void this.streamReaders
          .get(homeserver)
          ?.cancel()
          .catch(() => {});
        this.streamReaders.delete(homeserver);
        this.streamTargets.delete(homeserver);
      }
    }
  }

  private async runStream(owner: string, target: StreamTarget, generation: number): Promise<void> {
    const signature = streamSignature(target);
    const folderToPeer = new Map(target.folders.map((folder, index) => [folder, target.users[index][0]]));
    const peers = new Set(target.users.map(([peer]) => peer));
    while (generation === this.generation && this.state.isLeader) {
      let reader: ReadableStreamDefaultReader<THomeserverResourceEvent> | undefined;
      try {
        const stream = await ChatController.subscribeChatEventStream({
          homeserver: target.homeserver,
          users: target.users,
          pathPrefixes: [...target.folders.map(chatFolderPath), CHAT_LOG_PUBLIC_KEY],
        });
        if (generation !== this.generation) {
          await stream
            .getReader()
            .cancel()
            .catch(() => {});
          return;
        }
        reader = stream.getReader();
        this.streamReaders.set(target.homeserver, reader);
        for (;;) {
          const { done, value } = await reader.read();
          if (done || generation !== this.generation) break;
          if (!peers.has(value.owner)) continue;
          const parsed = parseChatEventPath(value.path);
          if (!parsed) continue;
          if ('key' in parsed) {
            this.scheduleEventSync(value.owner, 'key_event');
            continue;
          }
          if (value.eventType !== 'PUT') continue;
          const peer = folderToPeer.get(parsed.folderId);
          if (peer !== value.owner) continue;
          this.scheduleEventSync(peer, 'event', parsed.fileName);
        }
      } catch (error) {
        if (generation !== this.generation) return;
        Logger.warn('Chat event stream failed; reconnecting', { error });
      } finally {
        if (reader) await reader.cancel().catch(() => {});
        if (this.streamReaders.get(target.homeserver) === reader) this.streamReaders.delete(target.homeserver);
      }
      // Reconnect only while this is still the stream wanted for the homeserver; a refreshed
      // conversation set starts its own loop and this one must not come back beside it.
      if (this.streamTargets.get(target.homeserver) !== signature) return;
      await this.sleep(CHAT_SSE_RECONNECT_BACKOFF_MS, generation);
    }
  }

  private scheduleEventSync(peer: string, reason: 'event' | 'key_event', fileName?: string): void {
    const key = `${reason}:${peer}`;
    clearTimeout(this.eventTimers.get(key));
    this.eventTimers.set(
      key,
      setTimeout(() => {
        this.eventTimers.delete(key);
        void ChatController.fetchConversationUpdates(peer, reason, fileName).catch((error: unknown) => {
          Logger.warn('Chat sync after an event failed', { error });
        });
      }, CHAT_EVENT_DEBOUNCE_MS),
    );
  }

  private async isIdentityReady(): Promise<boolean> {
    if (useChatStore.getState().identityState === 'ready') return true;
    try {
      return (await ChatController.getOrFetchIdentity()) === 'ready';
    } catch {
      return false;
    }
  }

  /** Resolves when the identity becomes ready, the generation ends, or a retry is due. */
  private waitForIdentity(generation: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        unsubscribe();
        clearInterval(check);
        clearTimeout(retry);
        resolve();
      };
      const unsubscribe = useChatStore.subscribe((state) => {
        if (state.identityState === 'ready') finish();
      });
      const check = setInterval(() => {
        if (generation !== this.generation) finish();
      }, 250);
      const retry = setTimeout(finish, CHAT_INBOX_RETRY_MS);
    });
  }

  private sleep(ms: number, generation: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (generation !== this.generation) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 250);
      setTimeout(() => clearInterval(check), ms);
    });
  }
}
