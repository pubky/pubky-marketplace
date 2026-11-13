import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import type { CommerceAdapterMode } from '@/config/commerce';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { MuteController } from '@/controllers/mute/mute';
import { NotificationController } from '@/controllers/notification/notification';
import { clearDatabase } from '@/database/franky/franky.helpers';
import { chatMessageUrl } from '@/libs/chat/paths';
import { HttpMethod } from '@/libs/http/http.types';
import { Identity } from '@/libs/identity/identity';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { LocalFeedService } from '@/services/local/feed/feed';
import { LocalNotificationService } from '@/services/local/notification/notification';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { NexusBootstrapService } from '@/services/nexus/bootstrap/bootstrap';
import type { NexusNotification } from '@/services/nexus/nexus.types';
import { NexusUserService } from '@/services/nexus/user/user';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { mockKeypair } from '@/test-utils/pubky';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { AuthController } from './auth';
import { deferred, grantSession, resetGrantTest } from './auth.grant-test-utils';
import { AUTH_FINALIZATION_LOCK_NAME } from './auth-finalization-lock';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
// The profile bootstrap waits for Nexus to index the new profile first.
vi.mock('@/libs/utils/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sleep: vi.fn().mockResolvedValue(undefined),
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

    it('sign-out waits for a running bootstrap, which saves nothing it fetched for the account', async () => {
      const lockRequests = recordLockRequests();
      signIn(ALICE, false);
      vi.mocked(BootstrapApplication.initialize).mockRestore();
      const events: string[] = [];
      vi.spyOn(NexusBootstrapService, 'fetch').mockResolvedValue(asOpaque({ indexed: true }));
      vi.spyOn(HomeserverService, 'getJsonIfFound').mockResolvedValue({ found: true, json: { timestamp: 1 } });
      const feedsListing = deferred<string[]>();
      vi.spyOn(HomeserverService, 'list').mockImplementation(async ({ baseDirectory }) =>
        baseDirectory.endsWith('/feeds/') ? await feedsListing.promise : [],
      );
      vi.spyOn(HomeserverService, 'request').mockResolvedValue({ name: 'Bitcoin', feed: {}, created_at: 1 });
      vi.spyOn(PubkySpecsSingleton, 'get').mockReturnValue(
        asOpaque({
          createFeed: () => ({
            feed: { name: 'Bitcoin', feed: { tags: ['bitcoin'], reach: 'all', sort: 'recent', layout: 'columns' } },
            meta: { id: 'feed-1' },
          }),
        }),
      );
      const saveFeeds = vi.spyOn(LocalFeedService, 'createOrUpdateMany').mockImplementation(async (feeds) => {
        events.push('feeds saved');
        return feeds;
      });
      vi.mocked(clearDatabase).mockImplementation(async () => {
        events.push('local data cleared');
      });

      const bootstrap = AuthController.bootstrapWithDelay().then(() => events.push('bootstrap settled'));
      await vi.waitFor(() =>
        expect(HomeserverService.list).toHaveBeenCalledWith({ baseDirectory: `pubky://${ALICE}/pub/pubky.app/feeds/` }),
      );
      const requestsBeforeSignOut = lockRequests.length;
      const signOut = AuthController.logout();
      // The sign-out is queued behind the bootstrap, so it cannot clear anything yet.
      await vi.waitFor(() => expect(lockRequests.slice(requestsBeforeSignOut)).toContain(AUTH_FINALIZATION_LOCK_NAME));
      expect(clearDatabase).not.toHaveBeenCalled();

      feedsListing.resolve([`pubky://${ALICE}/pub/pubky.app/feeds/feed-1`]);
      await bootstrap;
      await signOut;

      expect(saveFeeds).not.toHaveBeenCalled();
      expect(events).toEqual(['bootstrap settled', 'local data cleared']);
      expect(useNotificationStore.getState().unread).toBe(0);
      expect(useAuthStore.getState().hasProfile).not.toBe(true);
    });
  });

  it('notification poll: an answer that arrives after sign-out starts is neither saved nor counted', async () => {
    signIn(ALICE);
    const nexus = deferred<NexusNotification[]>();
    vi.spyOn(NexusUserService, 'notifications').mockReturnValue(nexus.promise);
    const save = vi.spyOn(LocalNotificationService, 'bulkSave').mockResolvedValue(undefined);
    vi.spyOn(LocalNotificationService, 'countFilteredUnreadSince').mockResolvedValue(4);

    const poll = NotificationController.fetchNotifications({ userId: ALICE }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(NexusUserService.notifications).toHaveBeenCalled());
    const finishSignOut = startSignOut();
    nexus.resolve([]);
    const outcome = await poll;

    expect(save).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().unread).toBe(0);
    expect(outcome).toMatchObject({ name: 'AbortError' });
    await finishSignOut();
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

  it('mute sync: a mute list read before sign-out starts is not saved after it', async () => {
    signIn(ALICE);
    const listing = deferred<string[]>();
    vi.spyOn(HomeserverService, 'list').mockReturnValue(listing.promise);
    const save = vi.spyOn(LocalStreamUsersService, 'upsert').mockResolvedValue(undefined);

    const refresh = MuteController.fetchMutedUsers(ALICE).catch((error: unknown) => error);
    await vi.waitFor(() => expect(HomeserverService.list).toHaveBeenCalled());
    const finishSignOut = startSignOut();
    listing.resolve([`pubky://${ALICE}/pub/pubky.app/mutes/${BOB}`]);
    const outcome = await refresh;

    expect(save).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ name: 'AbortError' });
    await finishSignOut();
  });

  it('mute sync: a mute list read for one account is not saved after another account signs in over it', async () => {
    signIn(ALICE);
    const listing = deferred<string[]>();
    vi.spyOn(HomeserverService, 'list').mockReturnValue(listing.promise);
    const save = vi.spyOn(LocalStreamUsersService, 'upsert').mockResolvedValue(undefined);
    vi.spyOn(Identity, 'keypairFromMnemonic').mockReturnValue(mockKeypair());
    vi.spyOn(Identity, 'z32FromSession').mockReturnValue(BOB);
    vi.spyOn(AuthApplication, 'signIn').mockResolvedValue(
      asOpaque<Awaited<ReturnType<typeof AuthApplication.signIn>>>({ session: grantSession(BOB) }),
    );

    const refresh = MuteController.fetchMutedUsers(ALICE).catch((error: unknown) => error);
    await vi.waitFor(() => expect(HomeserverService.list).toHaveBeenCalled());
    await AuthController.loginWithMnemonic({ mnemonic: 'test mnemonic phrase' });
    expect(useAuthStore.getState().currentUserPubky).toBe(BOB);
    listing.resolve([`pubky://${ALICE}/pub/pubky.app/mutes/${BOB}`]);
    const outcome = await refresh;

    expect(save).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ name: 'AbortError' });
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
