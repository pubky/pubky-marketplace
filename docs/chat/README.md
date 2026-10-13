# Chat: buyer↔seller messaging on homeserver files

Private, end-to-end encrypted 1:1 messages between Shop users. Every message is one encrypted file on the
sender's own homeserver; the recipient reads it from there. Nothing in the Shop's own services ever sees a
message body, and no relay holds messages. This document describes the design as implemented; the working
log with decisions taken mid-way and the items pending with other teams is [`STATUS.md`](STATUS.md). The
decision record is [ADR 0030](../adr/0030-chat-transport.md).

Replaces the retired Paykit Encrypted Links (Noise XX) messaging, which needed a Pubky Ring cookie session on
both sides, both parties online for the handshake, and kept history on one device. Nothing was migrated: the
Shop had not launched when the rewrite landed.

## In one paragraph

Each user has a static X25519 chat key. The public half is a world-readable file on their homeserver; the
private half is a file under their homeserver's `/priv` tree. Two users derive the same pairwise root from
X25519 and HKDF, and from it an opaque **folder id** and a **message key**. A message is an
XChaCha20-Poly1305 envelope written to `pubky://<sender>/pub/chat/v0/<folder>/<timestamp>-<random>.json`;
the recipient lists and reads the sender's folder. New files reach the other side through the peer
homeserver's live event stream, an optional **inbox** ping service (wake-ups only, never the message), and a
reconciliation pass. A per-conversation record under `/priv` (with the read checkpoint) lets any device of the
account rebuild its inbox from the homeservers. Dexie is a cache; one leader tab per account runs the
background loops and every tab renders through Dexie live queries.

## Feature set (v0)

- Text only, at most 4,096 UTF-8 bytes per message. No attachments, reactions, receipts, typing, edit or
  delete, groups, blocking.
- One thread per user pair. A message may carry a `context` (`listingId` and/or `orderId`) that the thread
  shows as a chip.
- Routes: `/messages` (every conversation, newest activity first) and `/messages/[pubky]` (one thread;
  `?listing=` / `?order=` set the context of the next message). Entry points: **Message seller** on a
  listing, **Message about this order** on an order, **Message** on a profile, and the Messages item in the
  header, mobile footer and marketplace section nav with an unread badge.
- Works with every grant sign-in that holds the chat scopes (`/pub/chat/:rw`, `/priv/chat/:rw`): Bitkit,
  Ring and Passport. The inbox signs its session with the grant (see [Inbox](#inbox-pings)).

## Code map

| Area                                 | Path                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Limits and cadences                  | `src/config/chat.ts`                                                          |
| Crypto, paths, schemas, encoding     | `src/libs/chat/` (`crypto.ts`, `paths.ts`, `schemas.ts`, `encoding.ts`)       |
| Web Locks helpers, retry backoff     | `src/libs/chat/web-locks.ts`, `src/libs/chat/retry-backoff.ts`                |
| User-facing copy                     | `src/libs/chat/copy.ts`                                                       |
| Dexie models (v9)                    | `src/core/models/chat/`                                                       |
| Local cache service                  | `src/core/services/local/chat/chat.ts` (`LocalChatService`)                   |
| Homeserver records                   | `src/core/services/homeserver/chat/chat-storage.ts` (`ChatHomeserverService`) |
| Inbox client                         | `src/core/services/inbox/inbox.ts` (`InboxService`)                           |
| Workflows                            | `src/core/application/chat/chat.ts` (`ChatApplication`)                       |
| UI/coordinator entry point           | `src/core/controllers/chat/chat.ts` (`ChatController`)                        |
| Background loops, leader election    | `src/core/coordinators/chat-sync/chat-sync.ts` (`ChatSyncCoordinator`)        |
| Status store (identity, inbox, sync) | `src/core/stores/chat/`                                                       |
| Hooks                                | `src/hooks/useChat*`                                                          |
| Components                           | `src/components/organisms/Chat/`, `src/components/templates/Chat/`            |
| Pages                                | `src/app/messages/page.tsx`, `src/app/messages/[pubky]/page.tsx`              |
| Two-account live proof               | `src/test/e2e/chat-two-accounts.mjs` (`npm run test:e2e:chat`)                |

Session capabilities: `CAPABILITIES` in `src/config/app.ts`. Runtime config:
`inboxUrl` / `inboxAudience` in `src/libs/runtime-config/runtime-config.schema.ts`.

## Storage layout

### Homeserver

```text
pubky://<me>/pub/chat/v0/key.json                    public X25519 key (world-readable)
pubky://<me>/pub/chat/v0/<folder>/<file>             one encrypted file per message I SENT in that conversation
pubky://<me>/priv/chat/v0/key.json                   private key (owner-only; see Threat model)
pubky://<me>/priv/chat/v0/conversations/<peer>.json  conversation index entry + read checkpoint
```

- `<folder>` is 32 lowercase hex characters derived from the pair's shared secret (below). Only the two
  parties can compute it, and both compute the same one, so each party's folder for the pair has the same
  name on their own homeserver.
- `<file>` is `<sent_at ms, 13 digits zero-padded>-<8 random hex>.json`, so a directory list is
  chronological by the sender's clock.
- Messages I **received** live in the peer's folder on the peer's homeserver; messages I **sent** live in
  my folder on my homeserver. Neither party ever writes to the other's homeserver.

`/pub/chat/v0/key.json` (`chatPublicKeySchema`, strict):

```json
{ "v": 0, "alg": "x25519", "kid": "<16 hex>", "pk": "<base64url 32 bytes>", "created_at": 1760000000000 }
```

`kid` is the first 8 bytes of `sha256(pk)` in hex. `/priv/chat/v0/key.json` is the same record plus
`"sk": "<base64url 32 bytes>"`.

`/priv/chat/v0/conversations/<peer>.json` (`chatPrivConversationSchema`, strict):

```json
{
  "v": 0,
  "peer": "<peer pubky>",
  "folder_id": "<32 hex>",
  "peer_kid": "<16 hex>",
  "created_at": 1760000000000,
  "last_read_at": 1760000100000,
  "context": { "listingId": "…" }
}
```

`context` is `null` when the conversation has none.

### Message file

An envelope (`chatEnvelopeSchema`, strict):

```json
{
  "v": 0,
  "enc": "pubky-chat/xchacha20poly1305/v0",
  "ks": "<sender kid>",
  "kr": "<recipient kid>",
  "n": "<base64url 24-byte nonce>",
  "ct": "<base64url ciphertext>"
}
```

It decrypts to the plaintext (`chatPlaintextSchema`, strict):

```json
{
  "v": 0,
  "id": "<uuid, minted by the sender>",
  "from": "<sender pubky>",
  "to": "<recipient pubky>",
  "sent_at": 1760000000000,
  "body": "<1..4096 UTF-8 bytes>",
  "context": { "listingId": "…", "orderId": "…" }
}
```

A file whose JSON is larger than 8 KiB (`CHAT_FILE_MAX_BYTES`) is skipped on read.

### Dexie (database version 9)

Four tables, every row keyed by `owner_id` (the signed-in pubky). All four are a **cache** of homeserver state:
sign-out wipes them and sign-in rebuilds them. Version 9 adds them and drops the retired
`commerce_messaging_*` tables; `NEXT_PUBLIC_DB_VERSION` must be `9` everywhere (env default, `.env.example`,
Docker and Vercel env), or the chat tables are not declared and `db.table('chat_identity')` throws at import.

| Table                | Holds                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_identity`      | The account's key pair (`kid`, `public_key`, `secret_key`, `published`), mirrored from `/priv/chat/v0/key.json`.                                                                                                                                    |
| `chat_conversations` | One row per peer: `folder_id`, the cached peer key (`peer_key_id`, `peer_public_key`), `peer_state` (`ready` / `no_key`), `origin` (`local`, `remote`, `seeded`, `ping`), last-message preview, `last_read_at`, `last_context`, `priv_state_dirty`. |
| `chat_messages`      | One row per message in both directions: `file_name`, `sent_at`, `body`, `context`, `status` (`queued` / `sent` / `failed`), retry bookkeeping, `clock_skewed`. Row id is `<owner>:<message uuid>`, so re-ingesting a file is a no-op.               |
| `chat_sync_state`    | Per peer: homeserver list cursors for the peer's folder and my own, the peer's homeserver (cached pkarr lookup), key re-check time, failure counters, and the file owed an inbox ping with its retry schedule.                                      |

## Cryptography

Implemented in `src/libs/chat/crypto.ts` with `@noble/curves` (X25519), `@noble/hashes` (HKDF-SHA256) and
`@noble/ciphers` (XChaCha20-Poly1305).

```text
shared      = X25519(sk_me, pk_peer)                 rejected if all-zero (low-order peer key)
root        = HKDF-SHA256(ikm = shared, salt = "pubky-chat/v0", info = "root" || min(pk) || max(pk), 32)
folder id   = hex(HKDF-SHA256(ikm = root, salt = "pubky-chat/v0", info = "folder", 16))
message key = HKDF-SHA256(ikm = root, salt = "pubky-chat/v0", info = "message", 32)
AAD         = "<sender pubky>|<recipient pubky>|/pub/chat/v0/<folder>/<file>"
envelope    = XChaCha20-Poly1305(message key, random 24-byte nonce, AAD).encrypt(JSON(plaintext))
```

- `min(pk)`/`max(pk)` sort the two public keys bytewise, so both parties derive the same root, folder and
  key.
- The AAD binds a ciphertext to its direction and its path: a file copied to another folder, another
  owner's homeserver or another name fails authentication.
- Decryption never throws for bad input; it returns `malformed`, `unknown_key` (the envelope's `ks`/`kr` are
  not the expected pair), `unauthenticated` or `invalid_plaintext`, and the sync loop logs a count and skips
  the file. A plaintext whose `from`/`to` do not match the folder's owner and reader is skipped too.
- Key material is derived per `(me, peer, peer kid, my kid)` and cached in memory for the session; the root
  and shared secret are zeroed after derivation. The in-memory cache is cleared on sign-out.
- No forward secrecy: the keys are static. See [Threat model](#threat-model-notes).

## Identity provisioning

`ChatApplication.ensureIdentity` runs under the account's identity Web Lock so two tabs never mint two keys:

1. If Dexie already has a published identity, done.
2. If the session cannot write under `/priv/chat/` and `/pub/chat/` (`HomeserverService.canCurrentSessionWrite`
   reads the homeserver's own capability list), the state is `needs_reauth`: the UI says "Messages need a
   newer sign-in approval. Sign out and sign in again to turn them on." and the composer is disabled.
3. Otherwise read `/priv/chat/v0/key.json`. If it exists and is consistent (`kid` matches `pk`, both keys 32
   bytes), reuse it; this is how a second device gets the same key.
4. Otherwise generate a key pair, write the private record and **read it back** (it counts only once it
   round-trips).
5. Publish `/pub/chat/v0/key.json` if it is missing or advertises another `kid`, then save the identity to
   Dexie as published.

## Sequences

### Send

1. `ChatController.commitSendMessage` → `ChatApplication.queueMessage`: trims the body, checks it is 1 to
   4,096 bytes, makes sure a conversation row exists, mints the message uuid, `sent_at` and the file name,
   and stores the row as `queued`. The thread renders it at once ("Sending").
2. `flushOutbox` runs under the account's outbox lock (one tab at a time) and is skipped while
   `navigator.onLine === false`. For every due queued row, oldest file first:
   - Resolve the peer's key (below). A peer without a key leaves the row queued with
     `last_error = peer_not_enabled`, shown as "Waiting for them to set up messages", and re-probes the
     peer's `key.json` every 15 s (`CHAT_PEER_KEY_WAITING_RECHECK_MS`) while a message waits.
   - Encrypt and `PUT` the file to my folder. A retryable failure backs off (base 2 s, doubling, capped at
     5 min, jittered) for up to 8 attempts; a permanent failure or the 8th attempt marks the row `failed`
     ("Not sent", with Retry). A sent row is marked `sent` and the conversation's `/priv` record is marked
     dirty.
   - Record the file as the one owed an inbox ping for that conversation.
3. Dirty `/priv` conversation records are written at the end of the flush.
4. `flushPings`: for every conversation owed a ping, send one (never a condition for the message being
   sent; the file is already on my homeserver). A failed ping is retried with a jittered backoff
   (`CHAT_PING_RETRY_BASE_MS` to `CHAT_PING_RETRY_MAX_MS`; a 429 `Retry-After` takes precedence). While the
   peer has never written back, the newest file is pinged again every `CHAT_PING_REPEAT_MS` until they do (or
   the file is older than `CHAT_PING_REPEAT_MAX_AGE_MS`), so a dropped or expired first-contact ping still
   ends in a wake-up. Once the peer has replied they stream and reconcile the folder themselves.

Flush triggers: right after queueing, when the thread opens, on `online`, when the page becomes visible,
each reconcile pass, and when a keyless peer becomes reachable.

### Peer key resolution

`resolvePeerKey` uses the key cached on the conversation row when present. Otherwise (or when forced) it reads
the peer's `/pub/chat/v0/key.json`: absent or malformed means `no_key`, rechecked after 5 min
(`CHAT_PEER_KEY_RECHECK_MS`), at once when the user opens the thread, on a ping, or on a key event. A peer
whose `kid` changed is a new epoch: the folder id changes, list cursors reset, earlier messages stay in Dexie
and the new folder takes over.

### Receive and sync

`syncConversation(me, peer, { reason, hintFile })` runs in one tab per conversation (a second tab's call is
skipped) and does, in order:

1. Resolve the peer key (forced for `key_event`, and for `open`/`ping` when the peer had no key). If the
   peer just became reachable, flush the outbox.
2. If a hint file was given (event or ping), fetch and decrypt it first.
3. List the peer's folder after the stored cursor, 200 names per page, fetch 4 files at a time, decrypt, and
   add the rows (`addMessages` is idempotent by message id). The newest added message updates the
   conversation preview. Advance the cursor.
4. On `reconcile` and `rebuild`: a **tail check**. List the 25 newest files in reverse and ingest any not
   among the 50 newest known names. This catches files whose names sorted before the cursor (a sender whose
   clock lags).
5. On `rebuild`: also list my own folder for this peer (what another device of mine sent).

`sent_at` more than 5 min ahead of the local clock flags the row `clock_skewed`. Received rows are ordered
by `sent_at` (the sender's clock), with an explicit sort because Dexie's compound-index pagination returned
pages out of order in Chromium.

### Read state

Looking at a thread reads it: while the page is visible and the newest received message is newer than
`last_read_at`, the hook calls `commitMarkRead`, which moves the checkpoint, marks the `/priv` record dirty
and writes it. Unread for a conversation is the count of received messages with `sent_at > last_read_at`;
the nav badge counts conversations with at least one. The checkpoint travels with the account through
`/priv`, so another device clears the same badge.

### Cross-device rebuild

On sign-in (every tab, but the rebuild itself takes the account's rebuild lock so one tab does it):

1. `ensureIdentity` (reuses the stored private key).
2. List `/priv/chat/v0/conversations/` and create a conversation row for each record (origin `remote`,
   with its `last_read_at`, `created_at` and `context`); an existing row keeps the newer `last_read_at`.
3. `syncAll('rebuild')`: every conversation, three at a time, peer folder plus own folder.

A fresh browser therefore shows every conversation with both directions and the right unread state. The
two-account proof checks this (`alice:new-device-rebuild`).

## Delivery triggers

The coordinator (`ChatSyncCoordinator`) is started by `CoordinatorsManager` and disabled on the onboarding,
sign-in and logout routes.

**Every tab** on sign-in: identity, rebuild, outbox flush. On `online`: flush and request a reconcile. On
visibility change to visible: flush and request a reconcile.

**Leader tab only** (one per account, elected with an exclusive Web Lock `pubky-chat-leader|<pubky>`; the
browser hands the lock to a waiting tab when the holder closes):

1. **Homeserver event streams (SSE).** For the 20 most recent conversations with a known peer key
   (`CHAT_SSE_MAX_CONVERSATIONS`), grouped by the peer's homeserver (resolved through pkarr and cached in
   `chat_sync_state`), one `/events-stream` subscription per homeserver with up to 20 users each
   (`CHAT_SSE_MAX_USERS_PER_STREAM`; the SDK allows 50, the browser connection budget is the real limit),
   filtered to the conversation folders and `/pub/chat/v0/key.json`. A `PUT` under a folder schedules a
   sync for that peer with the file as hint after a 250 ms debounce; a `key.json` event schedules a
   `key_event` sync. A dropped stream reconnects after 2 s. Streams are refreshed whenever the conversation
   list changes (Dexie live query) and after each reconcile.
2. **Inbox long-poll.** See [Inbox](#inbox-pings).
3. **Reconciliation.** Every 60 s while the page is visible, every 5 min while hidden
   (`CHAT_RECONCILE_VISIBLE_MS` / `CHAT_RECONCILE_HIDDEN_MS`), and at once on focus, `online` and when
   becoming visible: counterparty discovery (below, at most every 10 min), outbox flush, `syncAll('reconcile')`,
   stream refresh. A pass lists every conversation with activity in the last 7 days
   (`CHAT_RECONCILE_ACTIVE_WINDOW_MS`); an older conversation is listed only when it has not been synced for an
   hour (`CHAT_RECONCILE_IDLE_MS`), so a long-tail inbox costs a bounded number of list requests per minute.
   Streams and pings still reach an idle conversation at once; the tier only sets the polling floor.
4. **Counterparty discovery** (`CHAT_DISCOVERY_INTERVAL_MS`, transactional commerce modes only, because
   orders live in the transaction service): the other party of every order is probed. A conversation row is
   created only when that peer has a published key and at least one message file exists in either folder,
   then the conversation is synced. This is how a conversation started on another device, or by the peer
   while this device had no inbox session, shows up without a ping.

**Open thread** (any tab): sync on mount, every 10 s while visible (`CHAT_OPEN_THREAD_POLL_MS`, the floor
for follower tabs and a dropped stream) and on focus.

## Inbox pings

The `pubky/inbox` service delivers tiny wake-ups so the recipient fetches a new file at once, and so a
**stranger's first message** is noticed at all (no stream or discovery pass knows about a peer the recipient
has never seen). A ping is never the message.

- **Session.** `POST <inbox>/v1/auth/session` with `{ grant, pop }`, where the proof is the session grant's
  custom proof-of-possession over `{ "type": "pubky-inbox-session-v1", "audience": <inbox audience> }`
  (`session.grant.createCustomPop`, SDK 0.16). The response `{ access_token, expires_at }` is kept in memory
  and mirrored to a `shop-` namespaced `localStorage` key (`chat-inbox-session:v1`) so one account holds one
  session across tabs. It is dropped 60 s before expiry and on a 401; sign-out sends
  `DELETE /v1/auth/session` best effort and forgets it; signing in as another account forgets the previous
  account's bearer. A session without a grant cannot sign the proof: `createInboxCredentials` returns `null`
  and the inbox is `disabled` for that sign-in (chat still works through streams and reconciliation).
- **Send.** `POST /v1/pings` with slot `chat-<folder id>` (slots are 1–64 Base64url characters; a colon is
  rejected), the recipient pubky, the payload `{ "v": 0, "t": "chat", "folder", "file", "p": <padding> }`
  padded to exactly 512 bytes (`CHAT_PING_MAX_BYTES`) so every ping has the same size, and
  `ttl_seconds = 604800` (7 days). The service keeps one pending ping per sender, recipient and slot, which is
  what makes retries and repeats free for the receiver: a repeat replaces the pending ping instead of adding one.
- **Receive.** The leader long-polls `GET /v1/pings?limit=50&wait=25` (25 s is the service cap). For each
  ping the **server-asserted sender** is the peer (the payload is only a hint): the conversation row is
  created if unknown (origin `ping`), the peer key is resolved, and the conversation is synced with the
  hinted file when its folder matches. Pings are acknowledged (`POST /v1/pings/ack`) after handling, for
  every device of the account. Failures back off from 1 s to 60 s; past 30 s the store reports the inbox as
  `unavailable`. When the inbox is `disabled` the loop re-checks every 5 min.

## Tabs, locks and the leader

`src/libs/chat/web-locks.ts`. Lock names are per account:

| Lock                               | Mode                | Guards                                                 |
| ---------------------------------- | ------------------- | ------------------------------------------------------ |
| `pubky-chat-leader\|<owner>`       | exclusive, held     | Leader election (inbox loop, streams, reconciliation). |
| `pubky-chat-identity\|<owner>`     | exclusive           | Key creation.                                          |
| `pubky-chat-outbox\|<owner>`       | exclusive           | Outbox flush.                                          |
| `pubky-chat-sync\|<owner>\|<peer>` | `ifAvailable`, skip | One sync per conversation at a time.                   |
| `pubky-chat-rebuild\|<owner>`      | `ifAvailable`, skip | The sign-in rebuild.                                   |

Without `navigator.locks` every helper runs the operation locally; all chat writes are idempotent by message
id, so an uncoordinated tab does the right thing, possibly twice. Never nest two `ifAvailable` requests for
the same name: the inner request sees the lock held and skips. Follower tabs render through Dexie live
queries (`useLiveQuery`), so everything the leader writes appears everywhere.

## Limits (`src/config/chat.ts`)

| Constant                                   | Value        | Meaning                                                      |
| ------------------------------------------ | ------------ | ------------------------------------------------------------ |
| `CHAT_BODY_MAX_BYTES`                      | 4096         | Message body cap, UTF-8 bytes.                               |
| `CHAT_FILE_MAX_BYTES`                      | 8192         | A larger message file is refused on read.                    |
| `CHAT_PING_MAX_BYTES`                      | 512          | Inbox payload size; every ping is padded to it.              |
| `CHAT_PING_TTL_SECONDS`                    | 7 days       | How long the inbox keeps an unread ping.                     |
| `CHAT_PING_RETRY_BASE_MS` / `_MAX_MS`      | 5 s / 10 min | Backoff bounds for a failed ping (a 429 `Retry-After` wins). |
| `CHAT_PING_REPEAT_MS`                      | 30 min       | Re-ping cadence while the peer has never written back.       |
| `CHAT_PING_REPEAT_MAX_AGE_MS`              | 7 days       | Re-pings stop once the newest sent file is this old.         |
| `CHAT_INBOX_WAIT_SECONDS`                  | 25           | Long-poll wait (service cap).                                |
| `CHAT_INBOX_PAGE`                          | 50           | Pings per poll.                                              |
| `CHAT_INBOX_RETRY_MS`                      | 5 min        | Re-check when the inbox is disabled or needs a grant.        |
| `CHAT_LIST_PAGE`                           | 200          | Homeserver list page.                                        |
| `CHAT_FETCH_CONCURRENCY`                   | 4            | Files fetched at once per conversation.                      |
| `CHAT_TAIL_CHECK_LIMIT`                    | 25           | Reverse-list size of the reconcile tail check.               |
| `CHAT_PEER_KEY_RECHECK_MS`                 | 5 min        | Re-probe cadence for a peer without a key.                   |
| `CHAT_PEER_KEY_WAITING_RECHECK_MS`         | 15 s         | Re-probe cadence while a queued message waits on that peer.  |
| `CHAT_CLOCK_SKEW_TOLERANCE_MS`             | 5 min        | `sent_at` further ahead than this is flagged.                |
| `CHAT_SEND_MAX_ATTEMPTS`                   | 8            | Then the message is `failed`.                                |
| `CHAT_SEND_RETRY_BASE_MS` / `_MAX_MS`      | 2 s / 5 min  | Exponential backoff bounds (jittered).                       |
| `CHAT_RECONCILE_VISIBLE_MS` / `_HIDDEN_MS` | 60 s / 5 min | Leader reconciliation cadence.                               |
| `CHAT_RECONCILE_ACTIVE_WINDOW_MS`          | 7 days       | Conversations with newer activity are listed every pass.     |
| `CHAT_RECONCILE_IDLE_MS`                   | 1 h          | Older conversations are listed once per this period.         |
| `CHAT_DISCOVERY_INTERVAL_MS`               | 10 min       | Order counterparty discovery cadence.                        |
| `CHAT_EVENT_DEBOUNCE_MS`                   | 250 ms       | Between an event-stream `PUT` and the sync it triggers.      |
| `CHAT_SSE_RECONNECT_BACKOFF_MS`            | 2 s          | Stream reconnect delay.                                      |
| `CHAT_SSE_MAX_USERS_PER_STREAM`            | 20           | Peers per homeserver stream (SDK cap 50).                    |
| `CHAT_SSE_MAX_CONVERSATIONS`               | 20           | Most recent conversations with live streams.                 |
| `CHAT_OPEN_THREAD_POLL_MS`                 | 10 s         | Open-thread poll while visible.                              |
| `CHAT_THREAD_PAGE`                         | 50           | Messages per page in a thread.                               |

These are project-wide hard limits; do not tune them per component.

## Configuration

| Variable                       | Default       | Meaning                                                                                                                                                   |
| ------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBKY_RUNTIME_INBOX_URL`      | unset         | Base URL of the `pubky/inbox` service. Empty or unset disables the inbox: chat degrades to event streams plus reconciliation (no stranger first contact). |
| `PUBKY_RUNTIME_INBOX_AUDIENCE` | the inbox URL | Audience string the inbox expects in session proofs (`INBOX_AUTH__AUDIENCE` on the service).                                                              |
| `NEXT_PUBLIC_DB_VERSION`       | `9`           | Must be 9 or higher: the chat tables arrive at Dexie version 9.                                                                                           |

The sign-in grant (`CAPABILITIES`) now includes `/pub/chat/:rw,/priv/chat/:rw`. A session approved before
this change lacks them and gets the `needs_reauth` notice until the user signs in again. The inbox deployment must allow the Shop's origin in `INBOX_SERVER__CORS_ALLOWED_ORIGINS`.

Errors: expected conditions (a peer without a key, an undecryptable file, an inbox that is down) are return
values and `Logger.warn` calls; `Err.*` is reserved for bugs and broken dependencies. Logs and error context
carry redacted paths (`/pub/chat/v0/<folder>/<file>`), never a folder id next to a peer.

## Local development

The recipe from `STATUS.md` ("How to resume"), against a local Pubky testnet:

```bash
# 1. Orientation
git log --oneline -20 && git status
# 2. App deps (worktree has its own node_modules)
npm install
npm run typecheck && npm test
# 3. Local stack (homeserver + pkarr + nexus + homegate)
cd /home/mk/CODE/pubky-docker && git pull && docker compose --profile backend up -d
# 4. Local inbox: clone pubky/inbox and build its Dockerfile as pubky-inbox:dev (Postgres comes from pubky-docker)
# 5. Ring simulator for approving sign-in QRs with disposable identities
cd /home/mk/CODE/pubky-ring-simulator && npm run dev
# 4b. Local inbox container (image built from the pubky/inbox Dockerfile as pubky-inbox:dev)
docker run -d --name pubky-inbox-dev --network pubky-docker_pubky -p 8088:8080 \
  -e INBOX_DATABASE__URL=postgres://test_user:test_pass@postgres:5432/inbox -e INBOX_AUTH__AUDIENCE=http://localhost:8088 \
  -e 'INBOX_SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:3000"]' -v pubky-inbox-dev-data:/data pubky-inbox:dev
# 5b. Two-account proof (dev server, homeserver and inbox container running)
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell npm run test:e2e:chat
# 6. The app against the local stack (see .env.example "Local testnet example")
PUBKY_RUNTIME_TESTNET=true PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080 \
PUBKY_RUNTIME_CDN_URL=http://localhost:8080/static PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/link/ \
PUBKY_RUNTIME_INBOX_URL=http://localhost:8088 PUBKY_RUNTIME_INBOX_AUDIENCE=http://localhost:8088 npm run dev
```

Notes:

- The dev signup-token route needs `HOMESERVER_ADMIN_URL=http://localhost:6288/generate_signup_token` and
  `HOMESERVER_ADMIN_PASSWORD=admin` (the local homeserver's admin password).
- `CHROMIUM_PATH` is needed where Playwright cannot install its own browser; point it at an existing
  `chrome-headless-shell`.
- The ring simulator's `node_modules` can lag its lockfile; run `npm ci` there and clear `node_modules/.vite`
  before `npm run dev`.

### Two-account live proof

`npm run test:e2e:chat` (`src/test/e2e/chat-two-accounts.mjs`) drives two Playwright browser contexts, Alice
and Bob, each registered on the local homeserver and signed in through the Shop's grant sign-in link (the
Bitkit option) approved by a Node-side signer; it needs the inbox the Shop is configured with. Checks: both
signed in; both keys published; Alice's first message reaches Bob's thread; Bob's reply reaches Alice's
**open** thread live; thread order; the inbox unread badge appears and clears on read; both tabs hold an inbox
session; with the event stream blocked a message still reaches Bob's inbox list through a ping, which is
acknowledged; history survives a reload; a fresh browser context rebuilds the conversation from the
homeservers; the published key file carries no secret; the message files on the homeserver are ciphertext.
Screenshots land in `.chat-e2e/` (`SCREENSHOT_DIR`).

## Threat model notes

What the design protects, and what it does not. Threat IDs refer to
[`../ecommerce/threat-model.md`](../ecommerce/threat-model.md).

- **Confidentiality.** Bodies and context are encrypted end to end under the pairwise key. Homeserver
  operators, the Shop's services, the inbox and the network see ciphertext only (checked by the live proof:
  `homeserver:messages-are-ciphertext`).
- **Integrity and authorship.** The AEAD tag under the pairwise key plus the AAD (sender, recipient, path)
  reject tampering and relocation. Authorship rests on the homeserver's write authorization: only the
  sender's session can write under `pubky://<sender>/pub/chat/v0/`. There is no separate signature; either
  party holds the pairwise key, so a recipient could forge "received" rows on their own device, never a file
  on the sender's homeserver.
- **Key authenticity.** A peer's public key is whatever their homeserver serves at
  `/pub/chat/v0/key.json` (trust on first use; no out-of-band fingerprint check). A homeserver operator who
  can write to a user's `/pub` tree could substitute a key. A changed `kid` switches to a new folder; it is
  logged, not surfaced to the user.
- **Private key at rest.** The thread shows a one-line note ("Messages are encrypted but stored on your
  homeserver. Keep payment details, passwords and ID numbers out of chat."), dismissable once per account, so
  users do not mistake v0 for a vault. `/priv/chat/v0/key.json` is plain JSON under the homeserver's owner-only tree. The
  homeserver enforces access, so the account's sessions (any app holding `/priv/chat/:rw`) and the homeserver
  operator can read it. Sealing it (for example under the marketplace data key used for `/priv` records, or a
  user-held secret) is deferred hardening. The key is also in Dexie (`chat_identity`) as plain bytes; XSS on
  the Shop origin reads it (WEB-02), as with every other local credential.
- **No forward secrecy.** The keys are static: a leaked private key opens every past and future message with
  every peer until the key is rotated. Rotation support is minimal: a peer's new `kid` starts a new folder,
  the earlier folder is no longer derived, so a new device rebuilds only the current epoch.
- **Metadata.** Folder ids are opaque and pairwise, but the same id appears on both homeservers, so an
  observer who can list both can link the two users; file names reveal send times and the count of messages;
  sizes are bounded by the 8 KiB cap but not padded. The inbox learns sender, recipient, slot (which contains
  the folder id) and timing; payloads are padded to a fixed size. The homeserver event stream subscription
  tells the peer's homeserver which users and folders this client watches.
- **Inbox rate limits.** A rate-limited or failed ping never loses a message: the file is already on the
  sender's homeserver, the ping is retried after `Retry-After`, and a first contact is pinged again until the
  peer answers.
- **Spam and abuse (MSG-05).** Anyone with an inbox session can ping anyone; a ping from an unknown sender
  creates a conversation entry on the recipient's device (the message itself only arrives if the sender has a
  published key and wrote a file). There is no block or mute in v0, and no rate limit on the client side; the
  inbox service owns admission.
- **Not in scope of chat.** Attachments and links (MSG-03) are not offered; order facts are never carried in
  messages (MSG-02): the listing/order chip is a pointer, not a claim about state.

## Known gaps

- **Stranger first contact needs the inbox.** Without `PUBKY_RUNTIME_INBOX_URL`, a message from someone the recipient has never talked to is found only when the recipient
  opens that thread, when order counterparty discovery runs (transactional commerce modes), or when another
  device of the recipient already recorded the conversation in `/priv`.
- **Private key unsealed in `/priv`** (above). Hardening later.
- **Inbox CORS and staging/production deployment** are pending with the inbox team, and the inbox's
  multi-device semantics (pings are wake-ups only) are an FYI to them; see the "Waiting on others" table in
  [`STATUS.md`](STATUS.md).
- **Re-approval.** Sessions approved before the chat scopes were added see the `needs_reauth` notice until
  they sign in again. The app had not launched, so no production session is affected.
- **No migration.** Conversations from the retired transport were device-local and are gone with the
  `commerce_messaging_*` tables (dropped at Dexie version 9).
- **`message_received` notifications** deep-link to `/messages` (no per-thread aggregate id in this model).
- The sandbox transaction service still carries its own plaintext `message.send` command for its server-side
  tests; nothing in the client calls it.
- A hard navigation while the inbox long-poll is in flight logs one `Err.network` ("Chat inbox poll
  failed") from the unloading page; client-side route changes do not.
