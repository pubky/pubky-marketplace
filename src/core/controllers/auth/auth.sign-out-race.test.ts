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
import { TtlController } from '@/controllers/ttl/ttl';
import { TtlCoordinator } from '@/coordinators/ttl/ttl';
import { clearDatabase } from '@/database/franky/franky.helpers';
import { chatMessageUrl } from '@/libs/chat/paths';
import type { PrivKeyring } from '@/libs/commerce/priv-envelope';
import { HttpMethod } from '@/libs/http/http.types';
import { Identity } from '@/libs/identity/identity';
import { Logger } from '@/libs/logger/logger';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import {
  COMMERCE_FIXTURE_SELLER,
  createCommerceCatalogEntryFixture,
  createNexusListingDetailsFixture,
} from '@/test/fixtures/commerce/commerce';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { mockKeypair } from '@/test-utils/pubky';
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
      // Read before the sign-out cleanup resets the commerce store.
      expect(useCommerceStore.getState().watchlistSyncStatus).toBe('idle');
      await finishSignOut();

      expect(apply).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(homeserver.log.filter((entry) => !entry.startsWith('GET ') && !entry.startsWith('LIST '))).toEqual([]);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Watchlist sync'), expect.anything());
    });

    it('a round that ends without keys as sign-out starts leaves the sync status alone', async () => {
      signIn(ALICE);
      installFakeHomeserver();
      const keys = deferred<Awaited<ReturnType<typeof CommercePrivKeyringApplication.get>>>();
      vi.spyOn(CommercePrivKeyringApplication, 'get').mockReturnValue(keys.promise);

      const sync = CommerceController.syncWatchlist();
      await vi.waitFor(() => expect(CommercePrivKeyringApplication.get).toHaveBeenCalledWith(ALICE));
      const finishSignOut = startSignOut();
      keys.resolve({ kind: 'unavailable' });
      await sync;

      // Read before the sign-out cleanup resets the commerce store.
      expect(useCommerceStore.getState().watchlistSyncStatus).toBe('idle');
      await finishSignOut();
    });

    it('a round whose scope is live reports its status', async () => {
      signIn(ALICE);
      installFakeHomeserver();
      vi.spyOn(CommercePrivKeyringApplication, 'get').mockResolvedValue({ kind: 'unavailable' });

      await CommerceController.syncWatchlist();

      expect(useCommerceStore.getState().watchlistSyncStatus).toBe('unavailable');
    });
  });

  it('watchlist detection: a pass that started before sign-out saves nothing after it', async () => {
    signIn(ALICE);
    const listingId = `${BOB}:boots_01`;
    vi.spyOn(LocalCommerceService, 'getFavorites').mockResolvedValue([
      { id: `${ALICE}|${listingId}`, owner_id: ALICE, listing_id: listingId, created_at: 1 },
    ]);
    vi.spyOn(LocalCommerceService, 'getWatchSnapshots').mockResolvedValue([]);
    const entry = deferred<Awaited<ReturnType<typeof LocalCommerceService.getCatalogEntry>>>();
    vi.spyOn(LocalCommerceService, 'getCatalogEntry').mockReturnValue(entry.promise);
    const save = vi.spyOn(LocalCommerceService, 'saveWatchDetection').mockResolvedValue(undefined);

    const pass = CommerceController.runWatchlistDetection();
    await vi.waitFor(() => expect(LocalCommerceService.getCatalogEntry).toHaveBeenCalledWith(listingId));
    const finishSignOut = startSignOut();
    entry.resolve(createCommerceCatalogEntryFixture({ id: listingId, seller_id: BOB }));

    await expect(pass).resolves.toEqual({ alertCount: 0 });
    expect(save).not.toHaveBeenCalled();
    await finishSignOut();
  });

  it('a pass that starts while sign-out cleanup still names the account ends with the cleanup', async () => {
    signIn(ALICE);
    const chatCleanup = deferred<void>();
    vi.spyOn(ChatController, 'clearForSignOut').mockReturnValue(chatCleanup.promise);
    const signOut = startSignOut()();
    await vi.waitFor(() => expect(ChatController.clearForSignOut).toHaveBeenCalledWith(ALICE));
    expect(useAuthStore.getState().currentUserPubky).toBe(ALICE);
    const passScope = captureAuthScope();

    chatCleanup.resolve();
    await signOut;

    expect(useAuthStore.getState().currentUserPubky).toBeNull();
    expect(passScope.aborted).toBe(true);
  });

  describe('watchlist detection against the index and the service', () => {
    const listingId = `${COMMERCE_FIXTURE_SELLER}:boots_01`;

    beforeEach(() => {
      commerceConfig.mode = 'transaction-service';
      signIn(ALICE);
      vi.spyOn(LocalCommerceService, 'getFavorites').mockResolvedValue([
        { id: `${ALICE}|${listingId}`, owner_id: ALICE, listing_id: listingId, created_at: 1 },
      ]);
      vi.spyOn(MarketplaceGatewayService, 'getListing').mockResolvedValue(null);
    });

    it('a pass whose scope ends during its local reads sends no request', async () => {
      const baselines = deferred<Awaited<ReturnType<typeof LocalCommerceService.getWatchSnapshots>>>();
      vi.spyOn(LocalCommerceService, 'getWatchSnapshots').mockReturnValue(baselines.promise);
      const fetchDetails = vi.spyOn(NexusMarketplaceService, 'fetchListingDetails');

      const pass = CommerceController.runWatchlistDetection();
      await vi.waitFor(() => expect(LocalCommerceService.getWatchSnapshots).toHaveBeenCalledWith(ALICE));
      const finishSignOut = startSignOut();
      baselines.resolve([]);

      await expect(pass).resolves.toEqual({ alertCount: 0 });
      expect(fetchDetails).not.toHaveBeenCalled();
      expect(MarketplaceGatewayService.getListing).not.toHaveBeenCalled();
      await finishSignOut();
    });

    it('a pass whose scope ends while it caches the index entries saves no detection', async () => {
      vi.spyOn(LocalCommerceService, 'getWatchSnapshots').mockResolvedValue([]);
      vi.spyOn(NexusMarketplaceService, 'fetchListingDetails').mockResolvedValue(createNexusListingDetailsFixture());
      const cached = deferred<void>();
      vi.spyOn(LocalCommerceService, 'bulkUpsertCatalogEntries').mockReturnValue(cached.promise);
      const save = vi.spyOn(LocalCommerceService, 'saveWatchDetection').mockResolvedValue(undefined);

      const pass = CommerceController.runWatchlistDetection();
      await vi.waitFor(() => expect(LocalCommerceService.bulkUpsertCatalogEntries).toHaveBeenCalled());
      const finishSignOut = startSignOut();
      cached.resolve();

      await expect(pass).resolves.toEqual({ alertCount: 0 });
      expect(save).not.toHaveBeenCalled();
      await finishSignOut();
    });
  });

  it.each(['after the new account is adopted', 'as the wipe ends'] as const)(
    'profile refresh: a TTL pass that starts while another account signs in over this one saves nothing when Nexus answers %s',
    async (answer) => {
      const CAROL = 'c'.repeat(52);
      signIn(ALICE);
      vi.spyOn(Identity, 'keypairFromMnemonic').mockReturnValue(mockKeypair());
      vi.spyOn(Identity, 'z32FromSession').mockReturnValue(BOB);
      vi.spyOn(AuthApplication, 'signIn').mockResolvedValue(
        asOpaque<Awaited<ReturnType<typeof AuthApplication.signIn>>>({ session: grantSession(BOB) }),
      );
      const wipe = deferred<void>();
      vi.mocked(clearDatabase).mockReturnValue(wipe.promise);
      vi.spyOn(TtlController, 'findStalePostsByIds').mockResolvedValue([]);
      vi.spyOn(TtlController, 'findStaleUsersByIds').mockResolvedValue([CAROL]);
      const users = deferred<Awaited<ReturnType<typeof NexusUserStreamService.fetchByIds>>>();
      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockReturnValue(users.promise);
      const saveUsers = vi.spyOn(LocalStreamUsersService, 'persistUsers').mockResolvedValue([]);
      const refresh = vi.spyOn(TtlController, 'forceRefreshUsersByIds');
      const ttl = TtlCoordinator.getInstance();
      ttl.configure({ batchIntervalMs: 60_000 });
      ttl.subscribeUser({ pubky: CAROL });

      try {
        const signInFlow = AuthController.loginWithMnemonic({ mnemonic: 'test mnemonic phrase' });
        await vi.waitFor(() => expect(clearDatabase).toHaveBeenCalled());
        ttl.start();
        await vi.waitFor(() =>
          expect(NexusUserStreamService.fetchByIds).toHaveBeenCalledWith({ user_ids: [CAROL], viewer_id: ALICE }),
        );
        wipe.resolve();
        if (answer === 'as the wipe ends') users.resolve([]);
        await signInFlow;
        expect(useAuthStore.getState().currentUserPubky).toBe(BOB);
        users.resolve([]);
        await Promise.allSettled(refresh.mock.results.map((result) => result.value));

        expect(saveUsers).not.toHaveBeenCalled();
      } finally {
        TtlCoordinator.resetInstance();
      }
    },
  );

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
