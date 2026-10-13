# ADR 0030: Chat Transport

## Status

Proposed — 2026-10-12 (implemented on `cc/pubky-messaging-rewrite-96c7a7`; becomes Accepted when that PR merges)

> **Note**: Update status when the decision changes. Include the date of status change.
>
> - **Proposed**: Under discussion, not yet implemented
> - **Accepted**: Approved and being/has been implemented
> - **Deprecated**: No longer recommended, but still in use (include deprecation date)
> - **Superseded**: Replaced by another ADR (link to replacement ADR)

## Context

The Shop needs private buyer↔seller messages: a buyer asks about a listing, the two sort out an order. The
first implementation ran over Paykit Encrypted Links (Noise XX) through a vendored browser WASM binding
(`paykit-wasm`), with the receiver key generated in the browser and conversation history in device-local
IndexedDB. In practice it only worked when **two Pubky Ring cookie users were both online, one device each**:

- The binding reached only the homeserver cookie, so grant sessions (Bitkit, Ring's grant auth, Passport)
  had no messaging at all, and Ring users could not move to grants without losing it.
- The Noise XX handshake is interactive: nothing could be delivered until the counterparty's runtime
  answered, and a message to someone who had not enrolled had nowhere to go.
- Keys and history lived in one browser. A second device, a reinstall or cleared site data lost the
  conversation; the multi-device backup-key decision was never made.
- It depended on a fork of paykit-rs that upstream does not plan to publish for the browser, carried its
  own re-approval flow (`/pub/paykit/:rw`), and had no independent security review.

The shared pubky-chat library (MLS) is the agreed long-term home for chat across Pubky apps, but its
Phase 2 and the inbox integration are owned by other teams and were not available in the launch window.
The Shop needed messaging that works for every sign-in, across devices, with the counterparty offline.

Facts the design rests on:

- A Pubky homeserver stores files; `/pub` is world-readable and `/priv` is owner-only, both written only by
  the owner's session. It serves a live `/events-stream` filtered by users and path prefixes, which the
  Shop already uses for mute-list sync.
- The `pubky/inbox` service delivers small, TTL-bounded pings to a recipient's pubky; a session comes from a
  grant and a custom proof-of-possession, which SDK 0.16 can produce for grant sessions only.
- The Shop's sign-in grant is a capability list the app chooses; adding scopes costs one re-approval, and the
  app had not launched.

## Decision

Chat is **encrypted files on the sender's own homeserver**, delivered by **homeserver event streams**, **inbox
pings** and **reconciliation**, end-to-end encrypted with a **static X25519 key per user**, and **inbox-first**
for first contact. Full description: [`docs/chat/README.md`](../chat/README.md).

1. **Storage.** Each user publishes `pubky://<me>/pub/chat/v0/key.json` and keeps the private key at
   `/priv/chat/v0/key.json`. Each pair derives, from X25519 and HKDF-SHA256, an opaque folder id and a
   message key. A message is one XChaCha20-Poly1305 envelope at
   `pubky://<sender>/pub/chat/v0/<folder>/<sent_at>-<random>.json`, AAD-bound to sender, recipient and
   path; the recipient reads the sender's folder. `/priv/chat/v0/conversations/<peer>.json` records each
   conversation and its read checkpoint so any device rebuilds the inbox from the homeservers. Dexie is a
   cache, wiped on sign-out.
2. **Delivery.** The leader tab subscribes to each peer homeserver's `/events-stream` for the conversation
   folders and `key.json`; it long-polls the inbox for pings (slot `chat-<folder>`, fixed-size payload, 7-day
   TTL, the server-asserted sender names the peer); and it reconciles by listing every known folder on a
   cadence (60 s visible, 5 min hidden, plus focus and online) with a tail check for lagging clocks. Order
   counterparties are discovered from the transaction service in transactional commerce modes. Every loop
   ends in the same idempotent sync.
3. **Inbox-first.** A stranger's first message is noticed through the inbox; without an inbox session
   (deployment without `PUBKY_RUNTIME_INBOX_URL`) chat still works through streams and reconciliation, and the gap is documented rather than papered over.
4. **Scopes.** The sign-in grant gains `/pub/chat/:rw` and `/priv/chat/:rw`. Sessions
   approved before that see a re-approval notice; the `/pub/paykit/:rw` enrollment flow is gone.
5. **Layering.** `ChatSyncCoordinator` → `ChatController` → `ChatApplication` → `ChatHomeserverService`,
   `InboxService`, `LocalChatService`, per [ADR 0004](./0004-layering-and-dependency-rules.md). One leader
   tab per account (Web Lock) runs the loops; follower tabs render through Dexie live queries.
6. **Minimal feature set.** Text up to 4,096 bytes, one thread per pair, a listing/order context chip. No
   reactions, images, receipts, typing, edit/delete, groups or blocking in v0.

## Consequences

### Positive ✅

- Works for every grant sign-in that holds the chat scopes: Bitkit, Ring and Passport.
- Store-and-forward: a message to an offline peer, or to one who has not opened Messages yet, waits on the
  sender's homeserver (and in the sender's queue while the peer has no key) and is delivered later.
- Multi-device by construction: keys and conversations live on the homeserver; a fresh browser rebuilds the
  inbox, including the read state.
- No Shop-operated relay holds messages; the transaction service has no message tables. Operators and the
  inbox see ciphertext and metadata only.
- Small, auditable crypto surface (`@noble` X25519, HKDF, XChaCha20-Poly1305) in `src/libs/chat/crypto.ts`
  instead of a vendored WASM fork; no handshake state machine to persist.
- Live delivery under a second on the stream path and about a second on the ping path, proven by the two-account e2e.

### Negative ❌

- No forward secrecy: static keys; a leaked private key opens every message with every peer.
- The private key sits unsealed under `/priv` (owner-only, but readable by the homeserver operator and by any
  session holding `/priv/chat/:rw`), and as plain bytes in IndexedDB. Hardening is deferred.
- Key authenticity is trust-on-first-use from the peer's homeserver; there is no fingerprint check.
- First contact from a stranger depends on the inbox, which needs a deployed, CORS-enabled inbox service;
  without it a stranger is reachable only once the recipient opens the thread or discovery finds the files.
- Metadata leaks: folder ids link a pair across both homeservers to an observer who can list both; file
  names carry send times; the inbox learns who pings whom.
- One more re-approval for existing sessions (acceptable: the app had not launched).

### Neutral ⚠️

- The homeserver's event stream and list API become a chat dependency: a homeserver without
  `/events-stream` still works through polling, slower.
- Delivery is at-least-once with idempotent writes; ordering follows the sender's clock (skew is flagged, not
  corrected).
- Each browser keeps up to 20 live streams, one per peer homeserver, for the 20 most recent conversations;
  older conversations are polled.
- A second chat protocol in the Pubky ecosystem until the pubky-chat (MLS) cutover; the data layout is
  versioned (`v0`) so a migration can read it.

## Alternatives Considered

### Alternative 1: Wait for pubky-chat (MLS) unification

**Description**: Adopt the shared pubky-chat library on MLS with its inbox, as planned for every Pubky app
(SSO-E1 in the launch plan).

**Pros**:

- One conversation across every Pubky app; group chat, forward secrecy and post-compromise security from
  MLS; owned by a dedicated team.

**Cons**:

- Not available in the launch window: Phase 2 and the inbox integration belong to other teams.
- The Shop would have shipped with no messaging for grant users and the broken Ring-only path meanwhile.

**Why not chosen**: Deferred, not rejected. This ADR's layout is versioned and the UI is transport-agnostic so
the cutover can replace the application and services layers; the inbox integration built here is the same
service pubky-chat will use.

### Alternative 2: Relay-only transport through the transaction service (the sandbox path)

**Description**: Keep messages in the marketplace service, as the sandbox adapter's plaintext `message.send`
does, with participant ACLs.

**Pros**:

- Simplest possible delivery and discovery; works for every session type; server-side spam control.

**Cons**:

- The operator reads every message; no end-to-end encryption, contrary to the Shop's honesty posture and
  threat model.
- Messages die with the operator; nothing is portable or verifiable (credible exit).
- The durable service deliberately has no conversation tables.

**Why not chosen**: Operator-readable messages were acceptable only as a labelled sandbox, never as the
product.

### Alternative 3: Keep Paykit Encrypted Links and fix the gaps

**Description**: Extend the vendored binding to grant sessions and add a backup key for multi-device.

**Pros**:

- Reuses an existing, live-proven implementation.

**Cons**:

- Upstream Paykit ships no WASM package, no storage interface and no custom-message API, and plans none; the
  fork would be the Shop's to maintain forever.
- The interactive handshake and single-device key model remain; store-and-forward would still be missing.

**Why not chosen**: The remaining gaps are structural, and Paykit's own direction is payments only.

### Alternative 4: Ratcheting keys (X3DH + Double Ratchet) now

**Description**: Per-message keys with forward secrecy and post-compromise security over the same file
layout.

**Pros**:

- Closes the static-key weakness.

**Cons**:

- Needs prekey bundles, session state persisted across devices and ordering guarantees the homeserver does
  not give; substantial complexity for a stop-gap transport.

**Why not chosen**: Out of proportion for v0; MLS brings these properties with the pubky-chat cutover.

## Implementation Notes

- Design and sequences: [`docs/chat/README.md`](../chat/README.md).
- Crypto and paths: `src/libs/chat/crypto.ts`, `src/libs/chat/paths.ts`, `src/libs/chat/schemas.ts`.
- Workflows: `src/core/application/chat/chat.ts`; loops: `src/core/coordinators/chat-sync/chat-sync.ts`.
- Dexie version 9 adds `chat_identity`, `chat_conversations`, `chat_messages`, `chat_sync_state` and drops
  the `commerce_messaging_*` tables (`src/core/database/franky/franky.ts`); `NEXT_PUBLIC_DB_VERSION=9`.
- Runtime config: `PUBKY_RUNTIME_INBOX_URL`, `PUBKY_RUNTIME_INBOX_AUDIENCE` ([environment](../environment.md)).
- Scopes: `CAPABILITIES` in `src/config/app.ts`.
- Proof: `npm run test:e2e:chat` against the local testnet and inbox.
- Rollout: no migration; existing sessions re-approve once.

## Related Decisions

- Depends on: [ADR 0004: Layering and dependency rules](./0004-layering-and-dependency-rules.md),
  [ADR 0008: Coordinators layer](./0008-coordinators-layer.md),
  [ADR 0017: Runtime config injection](./0017-runtime-config-injection.md)
- Related: [ADR 0014: Muting system](./0014-muting-system.md) (first use of the homeserver event stream),
  [ADR 0019: Marketplace transaction authority](./0019-marketplace-transaction-authority.md) (the service
  holds no message tables)
- Supersedes the encrypted-messaging record formerly under `docs/ecommerce/messaging/` (removed with the
  retired transport)

## References

- `pubky/inbox`: the ping service (session proof `pubky-inbox-session-v1`; `POST /v1/pings`, `GET /v1/pings`,
  `POST /v1/pings/ack`)
- [pubky-chat unification plan](https://github.com/pubky/pubky-chat/blob/main/docs/chat-unification-plan.md)
- [Shop launch plan](../launch/shop-launch-plan.md) and [SSO proposal](../sso/sso-proposal-for-team.md) for
  the history of the messaging decision

---

See [ADR Guidelines](../adr-guidelines.md) for when and how to write ADRs.
