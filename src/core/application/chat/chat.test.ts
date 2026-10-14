import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import {
  CHAT_LIST_MAX_PAGES_PER_PASS,
  CHAT_LIST_PAGE,
  CHAT_PEER_KEY_RECHECK_MS,
  CHAT_PING_REPEAT_MS,
  CHAT_RECONCILE_ACTIVE_WINDOW_MS,
  CHAT_RECONCILE_IDLE_MS,
} from '@/config/chat';
import { chatMessageUrl, chatPingSlot, chatPrivateKeyUrl, chatPublicKeyUrl } from '@/libs/chat/paths';
import { NetworkErrorCode, RateLimitErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  ChatConversationModel,
  ChatIdentityModel,
  ChatMessageModel,
  ChatSyncStateModel,
} from '@/models/chat/chat.models';
import { ChatHomeserverService } from '@/services/homeserver/chat/chat-storage';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

const ALICE = 'a'.repeat(52);
const BOB = 'b'.repeat(52);
const CAROL = 'c'.repeat(52);

describe('ChatApplication', () => {
  let homeserver: FakeHomeserver;

  beforeEach(async () => {
    installWebLocks();
    homeserver = installFakeHomeserver();
    vi.spyOn(HomeserverService, 'canCurrentSessionWrite').mockReturnValue(true);
    vi.spyOn(InboxService, 'isConfigured').mockReturnValue(false);
    await LocalChatService.clearAll();
  });

  afterEach(async () => {
    await LocalChatService.clearAll();
    removeWebLocks();
    vi.restoreAllMocks();
  });

  describe('identity', () => {
    it('creates, stores and publishes the key once', async () => {
      expect(await ChatApplication.ensureIdentity(ALICE)).toBe('ready');
      const identity = await ChatApplication.getIdentity(ALICE);
      expect(identity?.published).toBe(true);
      expect(homeserver.files.get(chatPrivateKeyUrl(ALICE))).toMatchObject({ v: 0, alg: 'x25519', kid: identity?.kid });
      expect(homeserver.files.get(chatPublicKeyUrl(ALICE))).toMatchObject({ kid: identity?.kid });
      expect(homeserver.files.get(chatPublicKeyUrl(ALICE))).not.toHaveProperty('sk');

      const writes = homeserver.log.filter((entry) => entry.startsWith('PUT')).length;
      expect(await ChatApplication.ensureIdentity(ALICE)).toBe('ready');
      expect(homeserver.log.filter((entry) => entry.startsWith('PUT')).length).toBe(writes);
    });

    it('reuses a key stored on the homeserver and republishes a missing public key', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      const kid = (await ChatApplication.getIdentity(ALICE))?.kid;
      await LocalChatService.clearAll();
      homeserver.files.delete(chatPublicKeyUrl(ALICE));

      expect(await ChatApplication.ensureIdentity(ALICE)).toBe('ready');
      expect((await ChatApplication.getIdentity(ALICE))?.kid).toBe(kid);
      expect(homeserver.files.get(chatPublicKeyUrl(ALICE))).toMatchObject({ kid });
    });

    it('reports needs_reauth without the chat scopes', async () => {
      vi.mocked(HomeserverService.canCurrentSessionWrite).mockReturnValue(false);
      expect(await ChatApplication.ensureIdentity(ALICE)).toBe('needs_reauth');
      expect(await ChatApplication.openConversation(ALICE, BOB)).toEqual({ state: 'needs_reauth' });
    });
  });

  describe('two-party round trip', () => {
    it('delivers both ways through the homeservers and keeps unread state', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      expect(await ChatApplication.openConversation(ALICE, BOB, { listingId: 'boots' })).toEqual({
        state: 'peer_not_enabled',
      });

      // Bob signs in somewhere and gets his key; Alice's next open sees it.
      await ChatApplication.ensureIdentity(BOB);
      expect(await ChatApplication.openConversation(ALICE, BOB)).toEqual({ state: 'ready' });

      const id = await ChatApplication.queueMessage(ALICE, {
        peer: BOB,
        body: 'Is this still available?',
        context: { listingId: 'boots' },
      });
      expect((await LocalChatService.getMessage(id))?.status).toBe('queued');
      await ChatApplication.flushOutbox(ALICE);
      const sent = await LocalChatService.getMessage(id);
      expect(sent?.status).toBe('sent');
      const alice = await LocalChatService.getConversation(ALICE, BOB);
      expect(alice?.folder_id).toMatch(/^[0-9a-f]{32}$/u);
      expect(alice?.own_folder_id).toMatch(/^[0-9a-f]{32}$/u);
      // Alice writes into her own folder, which differs from the one she reads Bob from.
      expect(alice?.own_folder_id).not.toBe(alice?.folder_id);
      expect(homeserver.files.has(chatMessageUrl(ALICE, alice!.own_folder_id!, sent!.file_name))).toBe(true);
      // The file on the homeserver is ciphertext, never the body.
      expect(
        JSON.stringify(homeserver.files.get(chatMessageUrl(ALICE, alice!.own_folder_id!, sent!.file_name))),
      ).not.toContain('available');
      // Alice's private index names the conversation.
      expect(await ChatHomeserverService.readConversationState(ALICE, BOB)).toMatchObject({
        peer: BOB,
        folder_id: alice!.folder_id,
      });

      // Bob discovers Alice as an order counterparty and syncs.
      await ChatApplication.seedConversations(BOB, [ALICE, CAROL]);
      expect(await LocalChatService.getConversation(BOB, CAROL)).toBeNull();
      const bobRow = await LocalChatService.getConversation(BOB, ALICE);
      // Bob reads the folder Alice writes into, and writes into the one Alice reads.
      expect(bobRow?.folder_id).toBe(alice!.own_folder_id);
      expect(bobRow?.own_folder_id).toBe(alice!.folder_id);
      const received = await LocalChatService.listMessages(BOB, ALICE, { limit: 10 });
      expect(received.map((row) => [row.direction, row.body, row.context])).toEqual([
        ['received', 'Is this still available?', { listingId: 'boots' }],
      ]);
      expect(await LocalChatService.countUnreadConversations(BOB)).toBe(1);
      expect(await ChatApplication.markRead(BOB, ALICE, Date.now())).toBe(true);
      expect(await LocalChatService.countUnreadConversations(BOB)).toBe(0);

      // Bob replies; Alice reconciles and sees it.
      await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'Yes, still here.' });
      await ChatApplication.flushOutbox(BOB);
      expect(await ChatApplication.syncConversation(ALICE, BOB, { reason: 'reconcile' })).toBe('synced');
      const thread = await LocalChatService.listMessages(ALICE, BOB, { limit: 10 });
      expect(thread.map((row) => [row.direction, row.body])).toEqual([
        ['sent', 'Is this still available?'],
        ['received', 'Yes, still here.'],
      ]);
      expect(await LocalChatService.countUnread(ALICE, BOB, 0)).toBe(1);

      // Syncing again adds nothing.
      await ChatApplication.syncConversation(ALICE, BOB, { reason: 'reconcile' });
      expect(await LocalChatService.countMessages(ALICE, BOB)).toBe(2);
    });

    it('handles an inbox ping from a stranger and uses its file hint', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'knock knock' });
      await ChatApplication.flushOutbox(ALICE);
      const alice = await LocalChatService.getConversation(ALICE, BOB);
      const file = (await LocalChatService.listMessages(ALICE, BOB, { limit: 1 }))[0].file_name;

      await ChatApplication.handlePing(BOB, {
        sender: ALICE,
        slot: chatPingSlot(alice!.own_folder_id!),
        revision: 'r1',
        received_at: 'now',
        expires_at: 'later',
        payload: JSON.stringify({ v: 0, t: 'chat', folder: alice!.own_folder_id, file }),
      });
      const bob = await LocalChatService.getConversation(BOB, ALICE);
      expect(bob?.origin).toBe('ping');
      expect((await LocalChatService.listMessages(BOB, ALICE, { limit: 5 })).map((row) => row.body)).toEqual([
        'knock knock',
      ]);

      // A ping with a bogus payload still works off the sender identity.
      await ChatApplication.handlePing(BOB, {
        sender: ALICE,
        slot: 'x',
        revision: 'r2',
        received_at: '',
        expires_at: '',
        payload: 'garbage',
      });
      expect(await LocalChatService.countMessages(BOB, ALICE)).toBe(1);
    });

    it('rebuilds a fresh device from the private index and both folders', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'from device one' });
      await ChatApplication.flushOutbox(ALICE);
      await ChatApplication.seedConversations(BOB, [ALICE]);
      await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'reply' });
      await ChatApplication.flushOutbox(BOB);
      await ChatApplication.markRead(ALICE, BOB, 123);
      await ChatApplication.flushPrivState(ALICE);

      // Device two: nothing local.
      await LocalChatService.clearAll();
      await ChatApplication.rebuildFromHomeserver(ALICE);
      const row = await LocalChatService.getConversation(ALICE, BOB);
      expect(row?.origin).toBe('remote');
      expect(row?.last_read_at).toBe(123);
      expect(
        (await LocalChatService.listMessages(ALICE, BOB, { limit: 10 })).map((r) => [r.direction, r.body]),
      ).toEqual([
        ['sent', 'from device one'],
        ['received', 'reply'],
      ]);
    });
  });

  describe('outbox', () => {
    it('backs off on retryable failures and fails permanently on others', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'hello' });

      vi.spyOn(ChatHomeserverService, 'putMessageFile').mockRejectedValueOnce(
        Err.network(NetworkErrorCode.CONNECTION_FAILED, 'offline', {
          service: ErrorService.Homeserver,
          operation: 'test',
        }),
      );
      await ChatApplication.flushOutbox(ALICE);
      const afterNetwork = await LocalChatService.getMessage(id);
      expect(afterNetwork?.status).toBe('queued');
      expect(afterNetwork?.attempts).toBe(1);
      expect(afterNetwork?.next_attempt_at).toBeGreaterThan(Date.now());

      await LocalChatService.updateMessage(id, { next_attempt_at: null });
      homeserver.failNext('PUT' as never, /\/pub\/chat\/v0\//u, 403);
      await ChatApplication.flushOutbox(ALICE);
      expect((await LocalChatService.getMessage(id))?.status).toBe('failed');

      await ChatApplication.retryMessage(ALICE, id);
      await ChatApplication.flushOutbox(ALICE);
      expect((await LocalChatService.getMessage(id))?.status).toBe('sent');
    });

    it('keeps a message queued while the peer has no key', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.openConversation(ALICE, BOB);
      const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'early' });
      await ChatApplication.flushOutbox(ALICE);
      const row = await LocalChatService.getMessage(id);
      expect(row?.status).toBe('queued');
      expect(row?.last_error).toBe('peer_not_enabled');
    });

    it('retries a failed ping after Retry-After and repeats it until the peer writes back', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.spyOn(InboxService, 'isConfigured').mockReturnValue(true);
        vi.spyOn(InboxService, 'ensureSession').mockResolvedValue('ready');
        const ping = vi.spyOn(InboxService, 'ping');
        const alicePings = () => ping.mock.calls.filter(([me]) => me === ALICE).length;
        ping.mockRejectedValueOnce(
          Err.rateLimit(RateLimitErrorCode.RATE_LIMITED, 'slow down', {
            service: ErrorService.Inbox,
            operation: 'ping',
            context: { retryAfter: 7 },
          }),
        );
        ping.mockResolvedValue(undefined);

        await ChatApplication.ensureIdentity(ALICE);
        await ChatApplication.ensureIdentity(BOB);
        await ChatApplication.openConversation(ALICE, BOB);
        const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'hello' });
        const sentAt = Date.now();
        await ChatApplication.flushOutbox(ALICE);

        // The message is sent regardless; the ping waits out the Retry-After.
        expect((await LocalChatService.getMessage(id))?.status).toBe('sent');
        expect(alicePings()).toBe(1);
        let state = await LocalChatService.getSyncState(ALICE, BOB);
        const file = (await LocalChatService.getMessage(id))?.file_name;
        expect(state?.ping_file).toBe(file);
        expect(state?.ping_attempts).toBe(1);
        expect(state?.ping_next_at).toBe(sentAt + 7_000);

        await ChatApplication.flushOutbox(ALICE);
        expect(alicePings()).toBe(1);

        vi.setSystemTime(sentAt + 7_000);
        await ChatApplication.flushOutbox(ALICE);
        expect(alicePings()).toBe(2);
        const folder = (await LocalChatService.getConversation(ALICE, BOB))?.own_folder_id;
        expect(ping).toHaveBeenLastCalledWith(
          ALICE,
          expect.objectContaining({ recipient: BOB, slot: chatPingSlot(folder!) }),
        );
        // Bob has never written back: the same file is pinged again later.
        state = await LocalChatService.getSyncState(ALICE, BOB);
        expect(state?.ping_attempts).toBe(0);
        expect(state?.ping_file).toBe(file);
        expect(state?.ping_next_at).toBe(sentAt + 7_000 + CHAT_PING_REPEAT_MS);

        // Bob replies; after the next ping nothing more is owed.
        await ChatApplication.openConversation(BOB, ALICE);
        await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'hi' });
        await ChatApplication.flushOutbox(BOB);
        await ChatApplication.syncConversation(ALICE, BOB, { reason: 'reconcile' });
        vi.setSystemTime(sentAt + 7_000 + CHAT_PING_REPEAT_MS);
        await ChatApplication.flushOutbox(ALICE);
        expect(alicePings()).toBe(3);
        state = await LocalChatService.getSyncState(ALICE, BOB);
        expect(state?.ping_file).toBeNull();
        await ChatApplication.flushOutbox(ALICE);
        expect(alicePings()).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the ping owed while the inbox is unavailable and sends it once it is', async () => {
      const ping = vi.spyOn(InboxService, 'ping').mockResolvedValue(undefined);
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'hello' });
      await ChatApplication.flushOutbox(ALICE);
      expect((await LocalChatService.getMessage(id))?.status).toBe('sent');
      expect(ping).not.toHaveBeenCalled();
      expect((await LocalChatService.getSyncState(ALICE, BOB))?.ping_file).toBeTruthy();

      vi.spyOn(InboxService, 'isConfigured').mockReturnValue(true);
      vi.spyOn(InboxService, 'ensureSession').mockResolvedValue('ready');
      await ChatApplication.flushOutbox(ALICE);
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('keeps a message to an unreachable peer queued without blocking other peers', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(CAROL);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.openConversation(ALICE, CAROL);
      const toBob = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'anyone there?' });
      const toCarol = await ChatApplication.queueMessage(ALICE, { peer: CAROL, body: 'hi carol' });

      // Bob's homeserver cannot be reached (no pkarr record, network down, 5xx).
      homeserver.failNext('GET' as never, new RegExp(`${BOB}/pub/chat/v0/key.json`, 'u'), 503);
      await ChatApplication.flushOutbox(ALICE);

      expect((await LocalChatService.getMessage(toBob))?.status).toBe('queued');
      expect((await LocalChatService.getMessage(toBob))?.last_error).toBe('peer_not_enabled');
      expect((await LocalChatService.getMessage(toCarol))?.status).toBe('sent');
    });

    it('keeps a known peer key while their homeserver is unreachable', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      expect(await ChatApplication.openConversation(ALICE, BOB)).toEqual({ state: 'ready' });

      homeserver.failNext('GET' as never, new RegExp(`${BOB}/pub/chat/v0/key.json`, 'u'), 503);
      const keys = await ChatApplication.resolvePeerKey(ALICE, BOB, { force: true });
      expect(keys.state).toBe('ready');
      expect((await LocalChatService.getConversation(ALICE, BOB))?.peer_state).toBe('ready');
    });

    it('re-probes a peer last seen without a key as soon as they ping', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      expect(await ChatApplication.openConversation(ALICE, BOB)).toEqual({ state: 'peer_not_enabled' });

      // Bob sets up messages and writes to Alice; his ping arrives before Alice's next recheck.
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(BOB, ALICE);
      await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'hello alice' });
      await ChatApplication.flushOutbox(BOB);
      await ChatApplication.handlePing(ALICE, {
        sender: BOB,
        slot: 'chat-unknown',
        revision: 'r1',
        received_at: 'now',
        expires_at: 'later',
        payload: 'not json',
      });

      expect((await LocalChatService.getConversation(ALICE, BOB))?.peer_state).toBe('ready');
      expect((await LocalChatService.listMessages(ALICE, BOB, { limit: 5 })).map((row) => row.body)).toEqual([
        'hello alice',
      ]);
    });

    it('lists only conversations with a message in the inbox', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      expect(await ChatApplication.getConversations(ALICE)).toEqual([]);
      expect(await ChatApplication.getConversations(ALICE, { includeEmpty: true })).toHaveLength(1);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'now it counts' });
      expect(await ChatApplication.getConversations(ALICE)).toHaveLength(1);
    });

    it('writes the /priv conversation record once, not once per message', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      const privWrites = () =>
        homeserver.log.filter((entry) => entry.startsWith('PUT') && entry.includes('/priv/chat/v0/conversations/'))
          .length;
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'one' });
      await ChatApplication.flushOutbox(ALICE);
      expect(privWrites()).toBe(1);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'two' });
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'three' });
      await ChatApplication.flushOutbox(ALICE);
      expect(privWrites()).toBe(1);
      // A new context on the thread is part of the record and does get written.
      await ChatApplication.queueMessage(ALICE, {
        peer: BOB,
        body: 'about the boots',
        context: { listingId: 'boots' },
      });
      await ChatApplication.flushOutbox(ALICE);
      expect(privWrites()).toBe(2);
    });

    it('does not rewrite unchanged /priv records on a new device', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'hello' });
      await ChatApplication.flushOutbox(ALICE);
      // Device two: the cache is empty, the record comes back from /priv.
      await LocalChatService.clearAll();
      ChatApplication.clearSessionsOfOtherAccounts(ALICE);
      const before = homeserver.log.filter(
        (entry) => entry.startsWith('PUT') && entry.includes('/priv/chat/v0/conversations/'),
      ).length;
      await ChatApplication.rebuildFromHomeserver(ALICE);
      await ChatApplication.flushPrivState(ALICE);
      const after = homeserver.log.filter(
        (entry) => entry.startsWith('PUT') && entry.includes('/priv/chat/v0/conversations/'),
      ).length;
      expect(after).toBe(before);
      expect((await LocalChatService.getConversation(ALICE, BOB))?.folder_id).toMatch(/^[0-9a-f]{32}$/u);
    });

    it('refuses self-chat and empty bodies', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await expect(ChatApplication.queueMessage(ALICE, { peer: ALICE, body: 'me' })).rejects.toThrow(/yourself/u);
      await expect(ChatApplication.queueMessage(ALICE, { peer: BOB, body: '   ' })).rejects.toThrow();
    });
  });

  describe('reconcile tiers', () => {
    it('lists recent conversations every pass and idle ones once per idle period', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.ensureIdentity(CAROL);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.openConversation(ALICE, CAROL);
      const now = Date.now();
      await LocalChatService.updateConversation(ALICE, CAROL, {
        last_message_at: now - CHAT_RECONCILE_ACTIVE_WINDOW_MS - 60_000,
      });
      await LocalChatService.updateSyncState(ALICE, CAROL, { last_synced_at: now });
      const sync = vi.spyOn(ChatApplication, 'syncConversation').mockResolvedValue('synced');

      await ChatApplication.syncAll(ALICE, 'reconcile');
      expect(sync.mock.calls.map(([, peer]) => peer)).toEqual([BOB]);

      await LocalChatService.updateSyncState(ALICE, CAROL, { last_synced_at: now - CHAT_RECONCILE_IDLE_MS });
      sync.mockClear();
      await ChatApplication.syncAll(ALICE, 'reconcile');
      expect(sync.mock.calls.map(([, peer]) => peer).sort()).toEqual([BOB, CAROL]);

      sync.mockClear();
      await ChatApplication.syncAll(ALICE, 'rebuild');
      expect(sync.mock.calls.map(([, peer]) => peer).sort()).toEqual([BOB, CAROL]);
    });
  });

  describe('sync robustness', () => {
    it('skips undecryptable files and follows a peer key rotation into a new folder', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'one' });
      await ChatApplication.flushOutbox(ALICE);
      const alice = await LocalChatService.getConversation(ALICE, BOB);
      homeserver.files.set(chatMessageUrl(ALICE, alice!.folder_id!, '1700000000000-aaaaaaaa.json'), {
        v: 0,
        junk: true,
      });
      await ChatApplication.seedConversations(BOB, [ALICE]);
      expect(await LocalChatService.countMessages(BOB, ALICE)).toBe(1);

      // Bob resets his key (new install without his private key).
      const oldFolder = alice!.folder_id;
      homeserver.files.delete(chatPrivateKeyUrl(BOB));
      await LocalChatService.saveIdentity({ ...(await ChatApplication.getIdentity(BOB))!, published: false });
      await LocalChatService.clearAll();
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.rebuildFromHomeserver(ALICE);
      expect(await ChatApplication.syncConversation(ALICE, BOB, { reason: 'key_event' })).toBe('synced');
      const rotated = await LocalChatService.getConversation(ALICE, BOB);
      expect(rotated?.folder_id).not.toBe(oldFolder);
      expect((await LocalChatService.getSyncState(ALICE, BOB))?.list_cursor).toBeNull();
    });

    // Bob reads Alice's first message, loses his private key (new install) and
    // re-keys on his next sign-in while Alice's tab sees no key event, so she
    // keeps the keys she cached. Bob then replies into the folder of the new pair.
    async function rekeyBobAndReply(): Promise<void> {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'hi bob' });
      await ChatApplication.flushOutbox(ALICE);
      await ChatApplication.seedConversations(BOB, [ALICE]);
      homeserver.files.delete(chatPrivateKeyUrl(BOB));
      await ChatIdentityModel.table.delete(BOB);
      for (const table of [ChatConversationModel.table, ChatMessageModel.table, ChatSyncStateModel.table]) {
        await table.where('owner_id').equals(BOB).delete();
      }
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(BOB, ALICE);
      await ChatApplication.queueMessage(BOB, { peer: ALICE, body: 'reply with a new key' });
      await ChatApplication.flushOutbox(BOB);
    }

    // Sorted: under a frozen clock both messages share a millisecond, so their order is the random suffix.
    const aliceBodies = async () =>
      (await LocalChatService.listMessages(ALICE, BOB, { limit: 5 })).map((row) => row.body).sort();

    it('lists at most CHAT_LIST_MAX_PAGES_PER_PASS pages of a peer folder per pass and keeps the cursor', async () => {
      await ChatApplication.ensureIdentity(ALICE);
      await ChatApplication.ensureIdentity(BOB);
      await ChatApplication.openConversation(ALICE, BOB);
      await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'one' });
      await ChatApplication.flushOutbox(ALICE);
      await ChatApplication.seedConversations(BOB, [ALICE]);

      // A peer whose folder always has another full page: one pass must stop at the cap.
      const page = Array.from(
        { length: CHAT_LIST_PAGE },
        (_, i) => `17000000${String(i).padStart(5, '0')}-aaaaaaaa.json`,
      );
      const list = vi.spyOn(ChatHomeserverService, 'listMessageFiles').mockResolvedValue(page);
      const read = vi.spyOn(ChatHomeserverService, 'readMessageFile').mockResolvedValue(null);
      try {
        await ChatApplication.syncConversation(BOB, ALICE, { reason: 'open' });
        expect(list).toHaveBeenCalledTimes(CHAT_LIST_MAX_PAGES_PER_PASS);
        expect((await LocalChatService.getSyncState(BOB, ALICE))?.list_cursor).toContain(page[page.length - 1]);
      } finally {
        list.mockRestore();
        read.mockRestore();
      }
    });

    it('notices a re-keyed peer from a ping that names their new folder', async () => {
      await rekeyBobAndReply();
      const bob = await LocalChatService.getConversation(BOB, ALICE);
      const file = (await LocalChatService.listMessages(BOB, ALICE, { limit: 1 }))[0].file_name;

      await ChatApplication.handlePing(ALICE, {
        sender: BOB,
        slot: chatPingSlot(bob!.own_folder_id!),
        revision: 'r1',
        received_at: 'now',
        expires_at: 'later',
        payload: JSON.stringify({ v: 0, t: 'chat', folder: bob!.own_folder_id, file }),
      });
      expect(await aliceBodies()).toEqual(['hi bob', 'reply with a new key']);
      expect((await LocalChatService.getConversation(ALICE, BOB))?.folder_id).toBe(bob!.own_folder_id);
    });

    it('notices a re-keyed peer on reconcile once the key check is stale', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        await rekeyBobAndReply();
        await ChatApplication.syncAll(ALICE, 'reconcile');
        expect(await aliceBodies()).toEqual(['hi bob']);

        vi.setSystemTime(Date.now() + CHAT_PEER_KEY_RECHECK_MS + 1);
        await ChatApplication.syncAll(ALICE, 'reconcile');
        expect(await aliceBodies()).toEqual(['hi bob', 'reply with a new key']);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
