import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommercePrivKeyringApplication } from '@/application/commerce/priv-keyring';
import { UserApplication } from '@/application/user/user';
import type { CommerceAdapterMode } from '@/config/commerce';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { clearDatabase } from '@/database/franky/franky.helpers';
import { chatMessageUrl } from '@/libs/chat/paths';
import type { PrivKeyring } from '@/libs/commerce/priv-envelope';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { AuthController } from './auth';
import { approve, deferred, grantSession, resetGrantTest } from './auth.grant-test-utils';
import { AUTH_FINALIZATION_LOCK_NAME } from './auth-finalization-lock';
import { captureAuthScope } from './auth-scope';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
const commerceConfig = vi.hoisted(() => ({ mode: 'sandbox' as string }));
vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const ALICE = 'a'.repeat(52);
const BOB = 'b'.repeat(52);

function signIn(pubky: string, hasProfile = true) {
  useAuthStore.getState().init({ session: grantSession(pubky), currentUserPubky: pubky, hasProfile });
}

/** Starts a sign-out and keeps it waiting on the homeserver revocation, as on a slow network. */
function startSignOut() {
  const revocation = deferred<void>();
  vi.mocked(AuthApplication.logout).mockReturnValue(revocation.promise);
  const signOut = AuthController.logout();
  return async () => {
    revocation.resolve();
    await signOut;
  };
}

/** Installs Web Locks and records the name of every lock requested, in order. */
function recordLockRequests(): string[] {
  installWebLocks();
  const names: string[] = [];
  const { request } = asOpaque<{ request: (name: string, ...rest: unknown[]) => Promise<unknown> }>(navigator.locks);
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: (name: string, ...rest: unknown[]) => {
        names.push(name);
        return request(name, ...rest);
      },
    },
    configurable: true,
  });
  return names;
}

/** Lets `method` finish its own work, then holds its result until `release`, as a slow device would. */
function holdAfter<K extends 'queueMessage' | 'retryMessage'>(method: K) {
  const original = ChatApplication[method].bind(ChatApplication) as (...args: unknown[]) => Promise<unknown>;
  const done = deferred<void>();
  const release = deferred<void>();
  vi.spyOn(ChatApplication, method).mockImplementation((async (...args: unknown[]) => {
    const result = await original(...args);
    done.resolve();
    await release.promise;
    return result;
  }) as never);
  return { done: done.promise, release: () => release.resolve() };
}

/** Records every outbox flush so a test can wait for one started in the background. */
function trackFlushes() {
  const original = ChatApplication.flushOutbox.bind(ChatApplication);
  const flushes: Promise<unknown>[] = [];
  vi.spyOn(ChatApplication, 'flushOutbox').mockImplementation((...args) => {
    const flush = original(...args);
    flushes.push(flush.catch((error: unknown) => error));
    return flush;
  });
  return flushes;
}

beforeEach(() => {
  resetGrantTest();
  commerceConfig.mode = 'sandbox';
  vi.mocked(clearDatabase).mockReset();
  useNotificationStore.getState().reset();
});
afterEach(() => {
  AuthController.cancelAllAuthFlows();
  vi.restoreAllMocks();
});

describe('work started for an account writes nothing for it once its sign-out starts', () => {
  describe('profile bootstrap', () => {
    afterEach(() => removeWebLocks());

    it('sign-out waits for a running bootstrap, which leaves the session unprepared', async () => {
      const lockRequests = recordLockRequests();
      vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
      vi.mocked(BootstrapApplication.initialize).mockRestore();
      const events: string[] = [];
      const inFlight = deferred<void>();
      vi.spyOn(BootstrapApplication, 'initialize').mockReturnValue(inFlight.promise);
      const session = grantSession(ALICE);
      await approve(session);
      const bootstrap = AuthController.initializeAuthenticatedSession({ session }).catch(() => {});

      await vi.waitFor(() => expect(BootstrapApplication.initialize).toHaveBeenCalled());
      vi.mocked(clearDatabase)
        .mockClear()
        .mockImplementation(async () => {
          events.push('local data cleared');
        });
      const requestsBeforeSignOut = lockRequests.length;
      const signOut = AuthController.logout();
      // The sign-out is queued behind the bootstrap, so it cannot clear anything yet.
      await vi.waitFor(() => expect(lockRequests.slice(requestsBeforeSignOut)).toContain(AUTH_FINALIZATION_LOCK_NAME));
      expect(clearDatabase).not.toHaveBeenCalled();

      events.push('bootstrap released');
      inFlight.resolve();
      await bootstrap;
      await signOut;

      expect(events).toEqual(['bootstrap released', 'local data cleared']);
      expect(useNotificationStore.getState().marketplaceUnread).toBe(0);
      expect(useAuthStore.getState().hasProfile).not.toBe(true);
    });
  });

  it('marketplace badge: a notification list that arrives after sign-out starts does not set the badge', async () => {
    signIn(ALICE);
    const notifications = deferred<Awaited<ReturnType<typeof CommerceApplication.getMarketplaceNotifications>>>();
    vi.spyOn(CommerceApplication, 'getMarketplaceNotifications').mockReturnValue(notifications.promise);

    const refresh = CommerceController.refreshMarketplaceNotificationBadge().catch((error: unknown) => error);
    await vi.waitFor(() => expect(CommerceApplication.getMarketplaceNotifications).toHaveBeenCalledWith(ALICE));
    const finishSignOut = startSignOut();
    notifications.resolve([createNotificationFixture('order_shipped', { readAt: null })]);
    const outcome = await refresh;

    expect(useNotificationStore.getState().marketplaceUnread).toBe(0);
    expect(outcome).toMatchObject({ name: 'AbortError' });
    await finishSignOut();
  });

  describe('watchlist sync', () => {
    const KEYRING: PrivKeyring = {
      ownerPubky: ALICE,
      currentKeyId: 'a'.repeat(32),
      keys: [{ keyId: 'a'.repeat(32), key: new Uint8Array(32).fill(3) }],
    };

    beforeEach(() => {
      commerceConfig.mode = 'transaction-service';
      installWebLocks();
      vi.spyOn(HomeserverService, 'hasActiveSession').mockReturnValue(true);
      vi.spyOn(HomeserverService, 'canCurrentSessionWrite').mockReturnValue(true);
      vi.spyOn(HomeserverService, 'isCurrentSessionGrant').mockReturnValue(false);
      vi.spyOn(LocalCommerceService, 'getFavorites').mockResolvedValue([]);
      vi.spyOn(LocalCommerceService, 'getWatchTombstones').mockResolvedValue([]);
      vi.spyOn(LocalCommerceService, 'getSyncJob').mockResolvedValue(asOpaque({ updated_at: 7 }));
    });
    afterEach(() => {
      removeWebLocks();
      CommerceApplication.resetWatchlistSyncInFlight();
    });

    it('a watchlist the sign-in sync reads as sign-out starts is neither applied locally nor written back', async () => {
      vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
      const homeserver = installFakeHomeserver();
      homeserver.files.set(`pubky://${ALICE}/priv/pubky.app/marketplace/v1/watchlist.json`, {
        schemaVersion: 1,
        recordType: 'watchlist',
        ownerPubky: ALICE,
        revision: 2,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        items: [{ listingOwnerPubky: BOB, listingId: 'boots_01', watchedAtMs: 100 }],
        tombstones: [],
      });
      const keys = deferred<Awaited<ReturnType<typeof CommercePrivKeyringApplication.get>>>();
      vi.spyOn(CommercePrivKeyringApplication, 'get').mockReturnValue(keys.promise);
      const apply = vi.spyOn(LocalCommerceService, 'applyWatchlistState').mockResolvedValue(undefined);
      const complete = vi.spyOn(LocalCommerceService, 'completeSyncJobIfUnchanged').mockResolvedValue(true);
      const rounds = vi.spyOn(CommerceApplication, 'syncWatchlist');
      const warn = vi.spyOn(Logger, 'warn');

      const session = grantSession(ALICE);
      await approve(session);
      await AuthController.initializeAuthenticatedSession({ session });
      await vi.waitFor(() => expect(CommercePrivKeyringApplication.get).toHaveBeenCalledWith(ALICE));
      const finishSignOut = startSignOut();
      keys.resolve({ kind: 'keys', keyring: KEYRING });
      await Promise.allSettled(rounds.mock.results.map((result) => result.value));
      await finishSignOut();

      expect(apply).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(homeserver.log.filter((entry) => !entry.startsWith('GET ') && !entry.startsWith('LIST '))).toEqual([]);
      expect(useCommerceStore.getState().watchlistSyncStatus).toBe('idle');
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Watchlist sync'), expect.anything());
    });
  });

  it('seller confirmation: a pass that started before sign-out confirms nothing after it starts', async () => {
    commerceConfig.mode = 'transaction-service';
    signIn(ALICE);
    const order = createOrderFixture('pending_payment', {
      id: '00000000-0000-4000-8000-000000000001',
      sellerPubky: ALICE,
      paymentMethod: 'paykit',
      paymentConfirmation: 'seller',
      paykitRequestState: 'awaiting_seller_confirmation',
    });
    vi.spyOn(MarketplaceGatewayService, 'getOrders').mockResolvedValue([order]);
    const detail = deferred<Awaited<ReturnType<typeof MarketplaceGatewayService.getOrder>>>();
    vi.spyOn(MarketplaceGatewayService, 'getOrder').mockReturnValue(detail.promise);
    const confirm = vi
      .spyOn(MarketplaceGatewayService, 'confirmBitcoinPayment')
      .mockResolvedValue({ order: null, confirmation: asOpaque({}) });

    const pass = CommerceController.autoConfirmSellerPayments();
    await vi.waitFor(() => expect(MarketplaceGatewayService.getOrder).toHaveBeenCalled());
    const finishSignOut = startSignOut();
    // The seller's pubky stays in the store until the sign-out cleanup runs.
    expect(useAuthStore.getState().currentUserPubky).toBe(ALICE);
    detail.resolve({ ...order, paykitObservation: { amountMatched: true, disappeared: false } });
    const confirmed = await pass;

    expect(confirm).not.toHaveBeenCalled();
    expect(confirmed).toEqual([]);
    await finishSignOut();
  });

  describe('chat sync', () => {
    beforeEach(async () => {
      installWebLocks();
      vi.spyOn(InboxService, 'isConfigured').mockReturnValue(false);
      await LocalChatService.clearAll();
    });
    afterEach(async () => {
      await LocalChatService.clearAll();
      removeWebLocks();
    });

    it('a message downloaded before sign-out starts is not stored after it', async () => {
      const homeserver = installFakeHomeserver();
      vi.spyOn(HomeserverService, 'canCurrentSessionWrite').mockReturnValue(true);
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.openConversation(BOB, ALICE);
      await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'Is this still available?' });
      await ChatApplication.flushOutbox(BOB);
      const [sent] = await LocalChatService.listMessages(BOB, ALICE, { limit: 1 });
      const bobFolder = (await LocalChatService.getConversation(BOB, ALICE))?.own_folder_id;
      expect(sent?.status).toBe('sent');
      expect(bobFolder).toBeTruthy();

      signIn(ALICE);
      const download = homeserver.holdNext(HttpMethod.GET, chatMessageUrl(BOB, bobFolder!, sent.file_name));
      const sync = ChatController.fetchConversationUpdates(BOB, 'event', sent.file_name).catch(
        (error: unknown) => error,
      );
      await download.reached;
      const finishSignOut = startSignOut();
      download.release();
      const outcome = await sync;

      expect(await LocalChatService.listMessages(ALICE, BOB, { limit: 10 })).toEqual([]);
      expect(outcome).toMatchObject({ name: 'AbortError' });
      await finishSignOut();
    });

    async function openAliceToBob() {
      const homeserver = installFakeHomeserver();
      vi.spyOn(HomeserverService, 'canCurrentSessionWrite').mockReturnValue(true);
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(BOB, ALICE);
      await ChatApplication.openConversation(ALICE, BOB);
      const aliceFolder = (await LocalChatService.getConversation(ALICE, BOB))?.own_folder_id;
      expect(aliceFolder).toBeTruthy();
      const messagePuts = () =>
        homeserver.log.filter((entry) =>
          entry.startsWith(`${HttpMethod.PUT} ${chatMessageUrl(ALICE, aliceFolder!, '')}`),
        );
      signIn(ALICE);
      return { homeserver, messagePuts };
    }

    it('a message queued as sign-out starts is not sent after it', async () => {
      const { messagePuts } = await openAliceToBob();
      const queueing = holdAfter('queueMessage');
      const flushes = trackFlushes();

      const send = ChatController.commitSendMessage({ peerPubky: BOB, body: 'Is this still available?' });
      await queueing.done;
      const finishSignOut = startSignOut();
      queueing.release();
      const id = await send;
      await Promise.all(flushes);

      expect(messagePuts()).toEqual([]);
      expect((await LocalChatService.getMessage(id))?.status).toBe('queued');
      await finishSignOut();
    });

    it('a message retried as sign-out starts is not sent after it', async () => {
      const { messagePuts } = await openAliceToBob();
      const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'Is this still available?' });
      await LocalChatService.updateMessage(id, { status: 'failed' });
      const retrying = holdAfter('retryMessage');
      const flushes = trackFlushes();

      const retry = ChatController.commitRetryMessage(id);
      await retrying.done;
      const finishSignOut = startSignOut();
      retrying.release();
      await retry;
      await Promise.all(flushes);

      expect(messagePuts()).toEqual([]);
      expect((await LocalChatService.getMessage(id))?.status).toBe('queued');
      await finishSignOut();
    });

    it('a peer key derived as sign-out starts is not kept in memory after it', async () => {
      await openAliceToBob();
      ChatApplication.clearSessionsOfOtherAccounts(ALICE);
      const { pairKeys } = asOpaque<{ pairKeys: Map<string, unknown> }>(ChatApplication);
      expect(pairKeys.size).toBe(0);
      const readState = LocalChatService.getSyncState.bind(LocalChatService);
      const reading = deferred<void>();
      const release = deferred<void>();
      vi.spyOn(LocalChatService, 'getSyncState').mockImplementationOnce(async (...args) => {
        const state = await readState(...args);
        reading.resolve();
        await release.promise;
        return state;
      });

      const resolving = ChatApplication.resolvePeerKey(ALICE, BOB, { signal: captureAuthScope() }).catch(
        (error: unknown) => error,
      );
      await reading.promise;
      await startSignOut()();
      release.resolve();
      const outcome = await resolving;

      expect(pairKeys.size).toBe(0);
      expect(outcome).toMatchObject({ name: 'AbortError' });
    });

    it('a message about a listing does not follow its seller once sign-out starts', async () => {
      const { homeserver } = await openAliceToBob();
      vi.spyOn(ChatApplication, 'flushOutbox').mockResolvedValue(undefined);
      const listing = deferred<Awaited<ReturnType<typeof CommerceApplication.getListing>>>();
      vi.spyOn(CommerceApplication, 'getListing').mockReturnValue(listing.promise);
      const exists = vi.spyOn(HomeserverService, 'exists').mockResolvedValue(false);
      const follow = vi.spyOn(UserApplication, 'ensureSellerFollow');

      await ChatController.commitSendMessage({
        peerPubky: BOB,
        body: 'Is this still available?',
        context: { listingId: 'listing-1' },
      });
      await vi.waitFor(() => expect(CommerceApplication.getListing).toHaveBeenCalledWith(`${BOB}:listing-1`));
      const finishSignOut = startSignOut();
      listing.resolve(asOpaque({ id: `${BOB}:listing-1` }));
      await finishSignOut();
      await Promise.all(follow.mock.results.map((result) => result.value));

      expect(homeserver.log.filter((entry) => entry.includes('/follows/'))).toEqual([]);
      expect(exists).not.toHaveBeenCalled();
    });
  });
});
