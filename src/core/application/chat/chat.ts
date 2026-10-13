import {
  CHAT_BODY_MAX_BYTES,
  CHAT_CLOCK_SKEW_TOLERANCE_MS,
  CHAT_FETCH_CONCURRENCY,
  CHAT_INBOX_PAGE,
  CHAT_INBOX_WAIT_SECONDS,
  CHAT_LIST_PAGE,
  CHAT_PEER_KEY_RECHECK_MS,
  CHAT_PEER_KEY_WAITING_RECHECK_MS,
  CHAT_PING_MAX_BYTES,
  CHAT_PING_REPEAT_MAX_AGE_MS,
  CHAT_PING_REPEAT_MS,
  CHAT_PING_RETRY_BASE_MS,
  CHAT_PING_RETRY_MAX_MS,
  CHAT_PING_TTL_SECONDS,
  CHAT_SEND_MAX_ATTEMPTS,
  CHAT_SEND_RETRY_BASE_MS,
  CHAT_SEND_RETRY_MAX_MS,
  CHAT_TAIL_CHECK_LIMIT,
} from '@/config/chat';
import {
  chatAad,
  chatKeyId,
  decryptChatEnvelope,
  derivePairwise,
  encryptChatEnvelope,
  generateChatKeypair,
} from '@/libs/chat/crypto';
import { base64UrlToBytes, bytesToBase64Url, utf8Bytes } from '@/libs/chat/encoding';
import {
  CHAT_PRIV_ROOT,
  CHAT_PUB_ROOT,
  chatMessagePath,
  chatMessageUrl,
  chatPingSlot,
  mintChatFileName,
} from '@/libs/chat/paths';
import { type ChatPingPayload, chatPingPayloadSchema, type ChatPlaintext } from '@/libs/chat/schemas';
import { CHAT_LOCKS, runInOneTab, withExclusiveLock } from '@/libs/chat/web-locks';
import { isAppError } from '@/libs/error/error';
import { AuthErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isRateLimitError, isRetryable } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { ChatConversationModel, ChatMessageModel } from '@/models/chat/chat.models';
import type {
  ChatContext,
  ChatConversationModelSchema,
  ChatConversationOrigin,
  ChatIdentityModelSchema,
  ChatMessageDirection,
  ChatMessageModelSchema,
} from '@/models/chat/chat.schema';
import { ChatHomeserverService } from '@/services/homeserver/chat/chat-storage';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import type { InboxAvailability, InboxPing, InboxPingRef } from '@/services/inbox/inbox.types';
import { LocalChatService } from '@/services/local/chat/chat';
import type {
  ChatIdentityState,
  ChatOpenResult,
  ChatPeerKeyResult,
  ChatPeerKeys,
  ChatQueueParams,
  ChatSyncOutcome,
  ChatSyncReason,
} from './chat.types';

type PairKeysCacheEntry = ChatPeerKeys & { myKid: string };

/**
 * Buyer↔seller chat on homeserver files.
 *
 * Messages I send live on MY homeserver under an opaque pairwise folder;
 * messages I receive live on the PEER's homeserver under the same folder id.
 * Dexie is a cache rebuilt from `/priv/chat/v0/conversations/*` plus both
 * folders. The inbox service only wakes the other side up.
 *
 * Expected failures (a peer without a key, an undecryptable file, an inbox
 * that is down) are return values and warnings, never `Err.*`: those log to
 * Sentry and mean a bug or a broken dependency.
 */
export class ChatApplication {
  private constructor() {}

  private static pairKeys = new Map<string, PairKeysCacheEntry>();

  // ================================================================ identity

  /**
   * The account's X25519 key, created on first use: the private key goes to
   * `/priv/chat/v0/key.json` (read back before it counts) and the public key
   * to `/pub/chat/v0/key.json`. Runs under the account's identity lock so two
   * tabs never mint two keys.
   */
  static async ensureIdentity(me: string): Promise<ChatIdentityState> {
    return await withExclusiveLock(CHAT_LOCKS.identity(me), async () => {
      const cached = await LocalChatService.getIdentity(me);
      if (cached?.published) return 'ready';
      if (
        !HomeserverService.canCurrentSessionWrite(CHAT_PRIV_ROOT) ||
        !HomeserverService.canCurrentSessionWrite(CHAT_PUB_ROOT)
      ) {
        return 'needs_reauth';
      }

      let identity = cached;
      if (!identity) {
        const stored = await ChatHomeserverService.readPrivateKey(me);
        if (stored) {
          const secretKey = base64UrlToBytes(stored.sk);
          const publicKey = base64UrlToBytes(stored.pk);
          if (secretKey?.length === 32 && publicKey?.length === 32 && chatKeyId(publicKey) === stored.kid) {
            identity = {
              id: me,
              kid: stored.kid,
              public_key: publicKey,
              secret_key: secretKey,
              published: false,
              created_at: stored.created_at,
            };
          } else {
            Logger.warn('Stored chat private key is inconsistent; creating a new one');
          }
        }
      }
      if (!identity) {
        const keypair = generateChatKeypair();
        const createdAt = Date.now();
        const kid = chatKeyId(keypair.publicKey);
        await ChatHomeserverService.writePrivateKey(me, {
          v: 0,
          alg: 'x25519',
          kid,
          pk: bytesToBase64Url(keypair.publicKey),
          sk: bytesToBase64Url(keypair.secretKey),
          created_at: createdAt,
        });
        identity = {
          id: me,
          kid,
          public_key: keypair.publicKey,
          secret_key: keypair.secretKey,
          published: false,
          created_at: createdAt,
        };
        Logger.info('Created the chat identity key');
      }

      const published = await ChatHomeserverService.readPublicKey(me);
      if (!published || published.kid !== identity.kid) {
        await ChatHomeserverService.publishPublicKey(me, {
          v: 0,
          alg: 'x25519',
          kid: identity.kid,
          pk: bytesToBase64Url(identity.public_key),
          created_at: identity.created_at,
        });
      }
      await LocalChatService.saveIdentity({ ...identity, published: true });
      return 'ready';
    });
  }

  static async getIdentity(me: string): Promise<ChatIdentityModelSchema | null> {
    return await LocalChatService.getIdentity(me);
  }

  // =================================================================== peers

  /**
   * The peer's key and everything derived from it. Reads the cached key on
   * the conversation row unless forced or stale; a peer without a published
   * key is `no_key` and rechecked on a cadence.
   */
  static async resolvePeerKey(me: string, peer: string, options: { force?: boolean } = {}): Promise<ChatPeerKeyResult> {
    const identity = await this.requireIdentity(me);
    const row = await LocalChatService.getConversation(me, peer);
    const state = await LocalChatService.getSyncState(me, peer);
    const stale = Date.now() - (state?.peer_key_checked_at ?? 0) > CHAT_PEER_KEY_RECHECK_MS;

    if (row?.peer_public_key && row.peer_key_id && !options.force) {
      const publicKey = base64UrlToBytes(row.peer_public_key);
      if (publicKey?.length === 32) return this.deriveFor(identity, peer, row.peer_key_id, publicKey);
    }
    if (row && row.peer_state === 'no_key' && !stale && !options.force) return { state: 'no_key' };

    const record = await ChatHomeserverService.readPublicKey(peer);
    await LocalChatService.updateSyncState(me, peer, { peer_key_checked_at: Date.now() });
    const publicKey = record ? base64UrlToBytes(record.pk) : null;
    if (!record || !publicKey || publicKey.length !== 32 || chatKeyId(publicKey) !== record.kid) {
      if (row && row.peer_state !== 'no_key') {
        await LocalChatService.updateConversation(me, peer, { peer_state: 'no_key' });
      }
      return { state: 'no_key' };
    }
    const keys = this.deriveFor(identity, peer, record.kid, publicKey);
    if (row) {
      const rotated = row.peer_key_id !== null && row.peer_key_id !== record.kid;
      await LocalChatService.updateConversation(me, peer, {
        peer_state: 'ready',
        peer_key_id: record.kid,
        peer_public_key: record.pk,
        folder_id: keys.folderId,
        priv_state_dirty: row.priv_state_dirty || rotated || row.folder_id !== keys.folderId,
      });
      if (rotated) {
        // New epoch: the peer re-keyed (new device, reset). Older messages
        // stay; new ones live in the folder both sides now derive.
        Logger.info('Chat peer key changed; switching to the new conversation folder');
        await LocalChatService.updateSyncState(me, peer, { list_cursor: null, own_list_cursor: null });
      }
    }
    return keys;
  }

  private static deriveFor(
    identity: ChatIdentityModelSchema,
    peer: string,
    peerKid: string,
    peerPublicKey: Uint8Array,
  ): ChatPeerKeys {
    const cacheKey = `${identity.id}:${peer}:${peerKid}:${identity.kid}`;
    const cached = this.pairKeys.get(cacheKey);
    if (cached) return cached;
    const { folderId, messageKey } = derivePairwise(identity.secret_key, identity.public_key, peerPublicKey);
    const entry: PairKeysCacheEntry = {
      state: 'ready',
      peerKid,
      peerPublicKey,
      folderId,
      messageKey,
      myKid: identity.kid,
    };
    this.pairKeys.set(cacheKey, entry);
    return entry;
  }

  private static async requireIdentity(me: string): Promise<ChatIdentityModelSchema> {
    const identity = await LocalChatService.getIdentity(me);
    if (identity) return identity;
    const state = await this.ensureIdentity(me);
    const created = await LocalChatService.getIdentity(me);
    if (state !== 'ready' || !created) {
      // Reads of /priv/chat and writes under /pub/chat need the chat scopes in the session grant.
      throw Err.auth(AuthErrorCode.FORBIDDEN, 'This sign-in cannot use messages yet; approve the chat scopes first.', {
        service: ErrorService.Homeserver,
        operation: 'requireIdentity',
      });
    }
    return created;
  }

  // =========================================================== conversations

  /** Makes sure a conversation row exists and reports whether the peer can be messaged. */
  static async openConversation(me: string, peer: string, context?: ChatContext): Promise<ChatOpenResult> {
    this.assertPeer(me, peer);
    if ((await this.ensureIdentity(me)) !== 'ready') return { state: 'needs_reauth' };
    const row = await this.ensureConversationRow(me, peer, 'local', context);
    // Opening is a user action: a peer who had no key last time gets one more look.
    const keys = await this.resolvePeerKey(me, peer, { force: row.peer_state === 'no_key' });
    return keys.state === 'ready' ? { state: 'ready' } : { state: 'peer_not_enabled' };
  }

  private static async ensureConversationRow(
    me: string,
    peer: string,
    origin: ChatConversationOrigin,
    context?: ChatContext,
    extra: Partial<ChatConversationModelSchema> = {},
  ): Promise<ChatConversationModelSchema> {
    const existing = await LocalChatService.getConversation(me, peer);
    if (existing) {
      if (context && !sameContext(existing.last_context, context)) {
        await LocalChatService.updateConversation(me, peer, { last_context: context });
        return { ...existing, last_context: context };
      }
      return existing;
    }
    const identity = await this.requireIdentity(me);
    const now = Date.now();
    const row: ChatConversationModelSchema = {
      id: ChatConversationModel.conversationId(me, peer),
      owner_id: me,
      peer_pubky: peer,
      folder_id: null,
      peer_key_id: null,
      peer_public_key: null,
      my_key_id: identity.kid,
      peer_state: 'no_key',
      origin,
      last_message_at: null,
      last_message_preview: null,
      last_message_direction: null,
      last_read_at: 0,
      last_context: context ?? null,
      priv_state_dirty: true,
      created_at: now,
      updated_at: now,
      ...extra,
    };
    await LocalChatService.upsertConversation(row);
    return row;
  }

  // ==================================================================== send

  /**
   * Persists the message first (`queued`), so it survives a closed tab, then
   * returns its id. Delivery is {@link flushOutbox}'s job.
   */
  static async queueMessage(me: string, params: ChatQueueParams): Promise<string> {
    const { peer, context } = params;
    this.assertPeer(me, peer);
    const body = params.body.trim();
    if (body.length === 0 || utf8Bytes(body) > CHAT_BODY_MAX_BYTES) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Write a message of at most 4,096 bytes.', {
        service: ErrorService.Local,
        operation: 'queueMessage',
      });
    }
    await this.ensureConversationRow(me, peer, 'local', context);
    const messageId = crypto.randomUUID();
    const sentAt = Date.now();
    const row: ChatMessageModelSchema = {
      id: ChatMessageModel.rowId(me, messageId),
      owner_id: me,
      peer_pubky: peer,
      direction: 'sent',
      file_name: mintChatFileName(sentAt),
      sent_at: sentAt,
      received_at: sentAt,
      body,
      context: context ?? null,
      status: 'queued',
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      clock_skewed: false,
    };
    await LocalChatService.putMessage(row);
    await LocalChatService.touchConversation(me, peer, { sentAt, body, direction: 'sent', context: context ?? null });
    return row.id;
  }

  /** Puts a failed message back in the queue for the next flush. */
  static async retryMessage(me: string, id: string): Promise<void> {
    const row = await LocalChatService.getMessage(id);
    if (!row || row.owner_id !== me || row.status !== 'failed') return;
    await LocalChatService.updateMessage(id, { status: 'queued', next_attempt_at: null, last_error: null });
  }

  /**
   * Sends every due queued message in file order: encrypt, PUT to my folder,
   * mark sent, then ping the inbox for every conversation that is owed one.
   * Exclusive per account across tabs. Retryable failures back off; permanent
   * ones mark the message `failed`.
   */
  static async flushOutbox(me: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    await withExclusiveLock(CHAT_LOCKS.outbox(me), async () => {
      await this.sendDueMessages(me);
      await this.flushPings(me);
    });
  }

  private static async sendDueMessages(me: string): Promise<void> {
    const due = await LocalChatService.listDueOutbox(me, Date.now());
    if (due.length === 0) return;
    const identity = await this.requireIdentity(me);
    const keysByPeer = new Map<string, ChatPeerKeyResult>();

    for (const row of due) {
      let keys = keysByPeer.get(row.peer_pubky);
      if (!keys) {
        // A message waiting on a keyless peer re-probes them on a short cadence:
        // the peer may have signed in seconds ago.
        const state = await LocalChatService.getSyncState(me, row.peer_pubky);
        const force = Date.now() - (state?.peer_key_checked_at ?? 0) > CHAT_PEER_KEY_WAITING_RECHECK_MS;
        keys = await this.resolvePeerKey(me, row.peer_pubky, { force });
        keysByPeer.set(row.peer_pubky, keys);
      }
      if (keys.state !== 'ready') {
        await LocalChatService.updateMessage(row.id, {
          next_attempt_at: Date.now() + CHAT_PEER_KEY_WAITING_RECHECK_MS,
          last_error: 'peer_not_enabled',
        });
        continue;
      }
      const messageId = row.id.slice(me.length + 1);
      const plaintext: ChatPlaintext = {
        v: 0,
        id: messageId,
        from: me,
        to: row.peer_pubky,
        sent_at: row.sent_at,
        body: row.body,
        ...(row.context ? { context: stripContext(row.context) } : {}),
      };
      const path = chatMessagePath(keys.folderId, row.file_name);
      try {
        const envelope = encryptChatEnvelope({
          messageKey: keys.messageKey,
          senderKid: identity.kid,
          recipientKid: keys.peerKid,
          aad: chatAad(me, row.peer_pubky, path),
          plaintext,
        });
        await ChatHomeserverService.putMessageFile(me, keys.folderId, row.file_name, envelope);
      } catch (error) {
        const attempts = row.attempts + 1;
        const permanent = !(isAppError(error) && isRetryable(error)) || attempts >= CHAT_SEND_MAX_ATTEMPTS;
        await LocalChatService.updateMessage(row.id, {
          attempts,
          status: permanent ? 'failed' : 'queued',
          next_attempt_at: permanent
            ? null
            : Date.now() + backoffDelay(attempts, CHAT_SEND_RETRY_BASE_MS, CHAT_SEND_RETRY_MAX_MS),
          last_error: error instanceof Error ? error.message : String(error),
        });
        Logger.warn('Chat message send failed', { permanent, attempts });
        continue;
      }
      await LocalChatService.updateMessage(row.id, {
        status: 'sent',
        attempts: row.attempts + 1,
        next_attempt_at: null,
        last_error: null,
      });
      await LocalChatService.updateConversation(me, row.peer_pubky, { priv_state_dirty: true });
      // The newest sent file is the one to wake the peer with; the inbox replaces the
      // pending ping per slot, so one ping per conversation is enough.
      await LocalChatService.updateSyncState(me, row.peer_pubky, {
        ping_file: row.file_name,
        ping_next_at: 0,
        ping_attempts: 0,
      });
    }
    await this.flushPrivState(me);
  }

  /**
   * Wake-ups through the inbox, never a condition for a message being sent:
   * the file is already on my homeserver. A failed ping is retried with a
   * backoff (a 429 `Retry-After` wins), and while the peer has never written
   * back the newest file is pinged again every {@link CHAT_PING_REPEAT_MS}, so a
   * dropped or expired first-contact ping still ends in a wake-up. Once the
   * peer has replied they stream and reconcile the folder themselves.
   */
  static async flushPings(me: string): Promise<void> {
    const now = Date.now();
    const due = (await LocalChatService.listSyncStates(me)).filter(
      (state) => state.ping_file !== null && (state.ping_next_at ?? 0) <= now,
    );
    if (due.length === 0) return;
    let availability: InboxAvailability;
    try {
      availability = await this.ensureInbox(me);
    } catch (error) {
      Logger.warn('Chat inbox session failed; pings wait for the next flush', { error });
      return;
    }
    if (availability !== 'ready') return;

    for (const state of due) {
      const peer = state.peer_pubky;
      const fileName = state.ping_file!;
      const conversation = await LocalChatService.getConversation(me, peer);
      if (!conversation?.folder_id) continue;
      const replied = await LocalChatService.hasReceivedFrom(me, peer);
      try {
        await InboxService.ping(me, {
          slot: chatPingSlot(conversation.folder_id),
          recipient: peer,
          payload: padPingPayload({ v: 0, t: 'chat', folder: conversation.folder_id, file: fileName }),
          ttlSeconds: CHAT_PING_TTL_SECONDS,
        });
        const expired = now - fileSentAt(fileName) > CHAT_PING_REPEAT_MAX_AGE_MS;
        await LocalChatService.updateSyncState(me, peer, {
          ping_file: replied || expired ? null : fileName,
          ping_next_at: replied || expired ? 0 : now + CHAT_PING_REPEAT_MS,
          ping_attempts: 0,
        });
      } catch (error) {
        const attempts = (state.ping_attempts ?? 0) + 1;
        const retryAfterMs = pingRetryAfterMs(error);
        const delay = retryAfterMs ?? backoffDelay(attempts, CHAT_PING_RETRY_BASE_MS, CHAT_PING_RETRY_MAX_MS);
        await LocalChatService.updateSyncState(me, peer, { ping_next_at: now + delay, ping_attempts: attempts });
        Logger.warn('Chat inbox ping failed; retrying later', { attempts, delay, rateLimited: retryAfterMs !== null });
      }
    }
  }

  // ================================================================= receive

  /**
   * Pulls everything new the peer wrote for me: a hinted file first, then
   * the folder after the stored cursor, then (on reconcile) a tail check for
   * files that sorted before the cursor. One tab per conversation at a time.
   */
  static async syncConversation(
    me: string,
    peer: string,
    options: { reason: ChatSyncReason; hintFile?: string },
  ): Promise<ChatSyncOutcome> {
    let outcome: ChatSyncOutcome = 'skipped';
    const ran = await runInOneTab(CHAT_LOCKS.sync(me, peer), async () => {
      outcome = await this.syncConversationLocked(me, peer, options);
    });
    return ran ? outcome : 'skipped';
  }

  private static async syncConversationLocked(
    me: string,
    peer: string,
    options: { reason: ChatSyncReason; hintFile?: string },
  ): Promise<ChatSyncOutcome> {
    const row = await LocalChatService.getConversation(me, peer);
    if (!row) return 'skipped';
    // A user opening the thread, a key event or a ping re-probes a peer without a
    // key at once; background passes wait for the recheck cadence instead.
    const force =
      options.reason === 'key_event' ||
      (row.peer_state === 'no_key' && (options.reason === 'open' || options.reason === 'ping'));
    const keys = await this.resolvePeerKey(me, peer, { force });
    if (keys.state !== 'ready') return 'peer_not_enabled';
    if (row.peer_state === 'no_key') {
      // The peer just became reachable: anything queued for them can go now.
      void this.flushOutbox(me).catch((error: unknown) => Logger.warn('Chat outbox flush failed', { error }));
    }
    const identity = await this.requireIdentity(me);
    const state = await LocalChatService.getSyncState(me, peer);

    try {
      if (options.hintFile) {
        await this.ingestFiles(me, peer, keys, identity, 'received', [options.hintFile]);
      }
      let cursor = state?.list_cursor ?? null;
      for (;;) {
        const names = await ChatHomeserverService.listMessageFiles(peer, keys.folderId, {
          cursor,
          limit: CHAT_LIST_PAGE,
        });
        if (names.length === 0) break;
        await this.ingestFiles(me, peer, keys, identity, 'received', names);
        cursor = chatMessageUrl(peer, keys.folderId, names[names.length - 1]);
        await LocalChatService.updateSyncState(me, peer, { list_cursor: cursor });
        if (names.length < CHAT_LIST_PAGE) break;
      }
      if (options.reason === 'reconcile' || options.reason === 'rebuild') {
        const tail = await ChatHomeserverService.listMessageFiles(peer, keys.folderId, {
          reverse: true,
          limit: CHAT_TAIL_CHECK_LIMIT,
        });
        const known = await LocalChatService.latestFileNames(me, peer, 'received', CHAT_TAIL_CHECK_LIMIT * 2);
        const missing = tail.filter((name) => !known.has(name));
        if (missing.length > 0) await this.ingestFiles(me, peer, keys, identity, 'received', missing);
      }
      if (options.reason === 'rebuild')
        await this.syncOwnFolder(me, peer, keys, identity, state?.own_list_cursor ?? null);
      await LocalChatService.updateSyncState(me, peer, {
        last_synced_at: Date.now(),
        consecutive_failures: 0,
        last_error: null,
      });
      return 'synced';
    } catch (error) {
      await LocalChatService.updateSyncState(me, peer, {
        consecutive_failures: (state?.consecutive_failures ?? 0) + 1,
        last_error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** My own folder for this peer: what another device of mine sent. */
  private static async syncOwnFolder(
    me: string,
    peer: string,
    keys: ChatPeerKeys,
    identity: ChatIdentityModelSchema,
    startCursor: string | null,
  ): Promise<void> {
    let cursor = startCursor;
    for (;;) {
      const names = await ChatHomeserverService.listMessageFiles(me, keys.folderId, { cursor, limit: CHAT_LIST_PAGE });
      if (names.length === 0) break;
      await this.ingestFiles(me, peer, keys, identity, 'sent', names);
      cursor = chatMessageUrl(me, keys.folderId, names[names.length - 1]);
      await LocalChatService.updateSyncState(me, peer, { own_list_cursor: cursor });
      if (names.length < CHAT_LIST_PAGE) break;
    }
  }

  private static async ingestFiles(
    me: string,
    peer: string,
    keys: ChatPeerKeys,
    identity: ChatIdentityModelSchema,
    direction: ChatMessageDirection,
    names: string[],
  ): Promise<void> {
    const owner = direction === 'received' ? peer : me;
    const sender = owner;
    const recipient = direction === 'received' ? me : peer;
    const senderKid = direction === 'received' ? keys.peerKid : identity.kid;
    const recipientKid = direction === 'received' ? identity.kid : keys.peerKid;
    const rows: ChatMessageModelSchema[] = [];
    let skipped = 0;

    for (let index = 0; index < names.length; index += CHAT_FETCH_CONCURRENCY) {
      const batch = names.slice(index, index + CHAT_FETCH_CONCURRENCY);
      const files = await Promise.all(
        batch.map((name) => ChatHomeserverService.readMessageFile(owner, keys.folderId, name)),
      );
      files.forEach((file, position) => {
        const name = batch[position];
        if (file === null) return;
        const opened = decryptChatEnvelope({
          messageKey: keys.messageKey,
          expectedSenderKid: senderKid,
          expectedRecipientKid: recipientKid,
          aad: chatAad(sender, recipient, chatMessagePath(keys.folderId, name)),
          envelope: file,
        });
        if (!opened.ok || opened.plaintext.from !== sender || opened.plaintext.to !== recipient) {
          skipped += 1;
          return;
        }
        const now = Date.now();
        rows.push({
          id: ChatMessageModel.rowId(me, opened.plaintext.id),
          owner_id: me,
          peer_pubky: peer,
          direction,
          file_name: name,
          sent_at: opened.plaintext.sent_at,
          received_at: now,
          body: opened.plaintext.body,
          context: opened.plaintext.context ?? null,
          status: 'sent',
          attempts: 0,
          next_attempt_at: null,
          last_error: null,
          clock_skewed: opened.plaintext.sent_at > now + CHAT_CLOCK_SKEW_TOLERANCE_MS,
        });
      });
    }
    if (skipped > 0)
      Logger.warn('Chat files skipped while syncing (undecryptable or mismatched)', { skipped, direction });
    if (rows.length === 0) return;
    const added = new Set(await LocalChatService.addMessages(rows));
    const newest = rows.filter((row) => added.has(row.id)).sort((a, b) => b.sent_at - a.sent_at)[0];
    if (newest) {
      await LocalChatService.touchConversation(me, peer, {
        sentAt: newest.sent_at,
        body: newest.body,
        direction,
        context: newest.context,
      });
    }
  }

  /** Every known conversation, most recent first, a few at a time. Errors are per conversation. */
  static async syncAll(me: string, reason: ChatSyncReason): Promise<void> {
    await this.flushPrivState(me);
    const conversations = await LocalChatService.listConversations(me);
    const queue = [...conversations];
    const workers = Array.from({ length: 3 }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          await this.syncConversation(me, next.peer_pubky, { reason });
        } catch (error) {
          Logger.warn('Chat conversation sync failed', { error });
        }
      }
    });
    await Promise.all(workers);
  }

  /**
   * Sign-in and new device: the conversation index from `/priv`, then every
   * folder on both sides. Runs in one tab.
   */
  static async rebuildFromHomeserver(me: string): Promise<void> {
    await runInOneTab(CHAT_LOCKS.rebuild(me), async () => {
      if ((await this.ensureIdentity(me)) !== 'ready') return;
      const records = await ChatHomeserverService.listConversationStates(me);
      for (const record of records) {
        if (record.peer === me) continue;
        const existing = await LocalChatService.getConversation(me, record.peer);
        if (!existing) {
          await this.ensureConversationRow(me, record.peer, 'remote', record.context ?? undefined, {
            last_read_at: record.last_read_at,
            priv_state_dirty: false,
            created_at: record.created_at,
          });
        } else if (record.last_read_at > existing.last_read_at) {
          await LocalChatService.updateConversation(me, record.peer, { last_read_at: record.last_read_at });
        }
      }
      await this.syncAll(me, 'rebuild');
    });
  }

  /**
   * Order/offer counterparties and other known contacts: a conversation row
   * is created only when the peer has already written to me.
   */
  static async seedConversations(me: string, peers: string[]): Promise<void> {
    if ((await this.ensureIdentity(me)) !== 'ready') return;
    for (const peer of new Set(peers)) {
      if (peer === me) continue;
      try {
        if (await LocalChatService.getConversation(me, peer)) continue;
        const identity = await this.requireIdentity(me);
        const record = await ChatHomeserverService.readPublicKey(peer);
        const publicKey = record ? base64UrlToBytes(record.pk) : null;
        if (!record || !publicKey || publicKey.length !== 32) continue;
        const keys = this.deriveFor(identity, peer, record.kid, publicKey);
        const newest = await ChatHomeserverService.listMessageFiles(peer, keys.folderId, { reverse: true, limit: 1 });
        const mine =
          newest.length > 0
            ? []
            : await ChatHomeserverService.listMessageFiles(me, keys.folderId, { reverse: true, limit: 1 });
        if (newest.length === 0 && mine.length === 0) continue;
        await this.ensureConversationRow(me, peer, 'seeded', undefined, {
          folder_id: keys.folderId,
          peer_key_id: record.kid,
          peer_public_key: record.pk,
          peer_state: 'ready',
        });
        await this.syncConversation(me, peer, { reason: 'rebuild' });
      } catch (error) {
        Logger.warn('Chat discovery failed for a counterparty', { error });
      }
    }
  }

  /** An inbox ping: the server-asserted sender identifies the peer; the payload is only a hint. */
  static async handlePing(me: string, ping: InboxPing): Promise<void> {
    const peer = ping.sender;
    if (!peer || peer === me) return;
    if ((await this.ensureIdentity(me)) !== 'ready') return;
    let payload: ChatPingPayload | null = null;
    try {
      const parsed = chatPingPayloadSchema.safeParse(JSON.parse(ping.payload));
      payload = parsed.success ? parsed.data : null;
    } catch {
      payload = null;
    }
    const existing = await LocalChatService.getConversation(me, peer);
    if (!existing) await this.ensureConversationRow(me, peer, 'ping');
    const keys = await this.resolvePeerKey(me, peer, { force: existing === null });
    if (keys.state !== 'ready') return;
    const hintFile = payload && payload.folder === keys.folderId ? payload.file : undefined;
    await this.syncConversation(me, peer, { reason: 'ping', hintFile });
  }

  // ============================================================== read state

  static async markRead(me: string, peer: string, at: number): Promise<boolean> {
    return await LocalChatService.markRead(me, peer, at);
  }

  /** Writes every dirty conversation record to `/priv`; failures stay dirty for the next pass. */
  static async flushPrivState(me: string): Promise<void> {
    const dirty = await LocalChatService.listDirtyConversations(me);
    for (const row of dirty) {
      if (!row.folder_id || !row.peer_key_id) continue;
      try {
        await ChatHomeserverService.writeConversationState(me, {
          v: 0,
          peer: row.peer_pubky,
          folder_id: row.folder_id,
          peer_kid: row.peer_key_id,
          created_at: row.created_at,
          last_read_at: row.last_read_at,
          context: row.last_context ? stripContext(row.last_context) : null,
        });
        await LocalChatService.updateConversation(me, row.peer_pubky, { priv_state_dirty: false });
      } catch (error) {
        Logger.warn('Chat conversation state write failed; retrying on the next pass', { error });
      }
    }
  }

  // =================================================================== inbox

  static async ensureInbox(me: string): Promise<InboxAvailability> {
    if (!InboxService.isConfigured()) return 'disabled';
    return await InboxService.ensureSession(me, (data) => HomeserverService.createInboxCredentials(data));
  }

  static async waitForPings(me: string, signal?: AbortSignal): Promise<InboxPing[]> {
    return await InboxService.waitForPings(me, {
      limit: CHAT_INBOX_PAGE,
      waitSeconds: CHAT_INBOX_WAIT_SECONDS,
      signal,
    });
  }

  static async ackPings(me: string, pings: InboxPingRef[]): Promise<void> {
    await InboxService.ack(me, pings);
  }

  // ================================================================= teardown

  /** Sign-out: forget the inbox session, the derived keys and every cached row. */
  static async clearSession(me: string | null): Promise<void> {
    this.pairKeys.clear();
    if (me) await InboxService.endSession(me);
    else InboxService.clearSession();
    await LocalChatService.clearAll();
  }

  static clearSessionsOfOtherAccounts(keepPubky: string): void {
    this.pairKeys.clear();
    InboxService.clearSessionsOfOtherAccounts(keepPubky);
  }

  // ================================================================== helpers

  private static assertPeer(me: string, peer: string): void {
    if (peer === me) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'You cannot message yourself.', {
        service: ErrorService.Local,
        operation: 'assertPeer',
      });
    }
  }
}

function backoffDelay(attempts: number, baseMs: number, maxMs: number): number {
  const cap = Math.min(maxMs, baseMs * 2 ** (attempts - 1));
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

/** The `Retry-After` of a rate-limited inbox call in ms, else null. */
function pingRetryAfterMs(error: unknown): number | null {
  if (!isAppError(error) || !isRateLimitError(error)) return null;
  const retryAfter = error.context?.retryAfter;
  return typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter * 1000 : null;
}

/** The sender's clock at send time, from the `<ms>-<rand>.json` file name. */
function fileSentAt(fileName: string): number {
  const ms = Number.parseInt(fileName.slice(0, 13), 10);
  return Number.isFinite(ms) ? ms : 0;
}

function sameContext(a: ChatContext | null, b: ChatContext | null | undefined): boolean {
  return (a?.listingId ?? null) === (b?.listingId ?? null) && (a?.orderId ?? null) === (b?.orderId ?? null);
}

/** Drops undefined members so the plaintext schema (strict) accepts it. */
function stripContext(context: ChatContext): ChatContext {
  const out: ChatContext = {};
  if (context.listingId) out.listingId = context.listingId;
  if (context.orderId) out.orderId = context.orderId;
  return out;
}

/** Serializes a ping and pads it to exactly {@link CHAT_PING_MAX_BYTES} so every ping looks the same size. */
export function padPingPayload(payload: ChatPingPayload): string {
  const base = JSON.stringify({ ...payload, p: '' });
  const room = CHAT_PING_MAX_BYTES - utf8Bytes(base);
  return JSON.stringify({ ...payload, p: 'x'.repeat(Math.max(0, room)) });
}
