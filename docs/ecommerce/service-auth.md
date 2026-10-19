# Authenticating the Browser to the Transaction Service

> Historical design: the cookie sign-in and dual-AuthToken flow described here have been superseded. See [grant authentication](../launch/grant-auth-session.md) for the current sign-in, service approval and migration contract.

How the app proves who it is to the Marketplace Transaction Service, and why the first design was wrong.

## The problem with challenge–response signing

The transaction service was originally built to authenticate with an ed25519 challenge–response handshake: the service issues a nonce, the client signs it with the user's key, the service verifies the signature against the z-base-32 pubky.

**The browser cannot do that.** In the normal Pubky App flow the user signs in through Pubky Ring, an external signer device, and the app never holds the secret key. The `Keypair` class in `@synonymdev/pubky` exposes `publicKey` but no signing method at all, and the only in-app path that even produces a `Keypair` is recovery-file import.

So a client-side signature is not available, and no amount of client work makes it available. The design has to change, not the client.

## The mechanism Pubky actually provides

`AuthToken` — described in the SDK as a "signed, time-bound proof of key ownership." It is produced by the auth flow's `awaitToken()`, which blocks until the user approves on their signer device. Its own documentation states the intended use:

```js
const bytes = token.toBytes();
await fetch('/api/verify', { method: 'POST', body: bytes });
```

and on the server:

```js
const token = AuthToken.verify(bytes); // throws on failure
token.publicKey; // the authenticated pubky
token.capabilities; // what the flow requested
```

The token serializes to a canonical postcard binary form. Verification is a pure function of the bytes — no round-trip to the signer, no homeserver call.

This is the correct boundary: the signer device holds the key and signs, the service verifies a signature it did not have to trust the client for.

## Design

1. The app obtains an `AuthToken` for the marketplace service through the Pubky auth flow and sends `token.toBytes()` to `POST /v1/auth/sessions`.
2. The service verifies the token, extracts `publicKey` as the actor and `capabilities` as the granted scope, and issues its own opaque short-lived session token for subsequent requests.
3. The service enforces replay protection itself rather than relying on the token being time-bound: each token is single-use, bound to its own identifier and expiry, and rejected outside a bounded acceptance window.
4. The existing challenge endpoint is removed. It cannot be satisfied by any real client, so keeping it would be dead surface that implies a capability the system does not have.

The service's own session tokens continue to work as they do today (opaque, hashed at rest, TTL, Bearer on `/v1/commands`), so only the establishment step changes.

## Where the bearer token lives in the browser

The original rule was memory-only: the token died on any reload, which in field testing meant every reload or new tab demanded another Pubky Ring approval. That cost users real friction for little security gain, so the rule is deliberately loosened — this section is the record of exactly how far.

**What is stored, and where.** On session establishment the client writes one value to `localStorage` under the key `pubky.marketplace.session.v1`: a JSON object containing the opaque bearer token, the account pubky it was minted for, the granted capability string, and the expiry timestamp. Nothing else. The token is still never written to IndexedDB or cookies, and never logged; the in-memory copy remains what requests read from.

**Why `localStorage` now.** The first loosening (2026-08-21, same-day) used per-tab `sessionStorage` — the narrowest storage that fixed the reload complaint — which still demanded a fresh Ring approval in every new tab and after every browser restart. That was widened the same day, by explicit user decision, to `localStorage`: the signer approval is a rare ceremony, and the boundary on the token's life is the service-side TTL plus sign-out — not tab lifetime. A new device still requires a fresh signer approval; nothing syncs.

**Restore is validated, not trusted.** On app boot, after the app's own homeserver session restore has identified the signed-in account, the client re-reads the stored blob and drops it unless it parses against the session schema, its pubky matches the restored account, and it has not passed the client-side expiry margin. Sign-out and account switch clear it (both funnel through the same cleanup as the in-memory session). If the service itself no longer accepts a restored token, the first request answers 401, the client clears the session everywhere, and the "Connect marketplace session" affordance resurfaces — the service stays the authority on validity.

**The tradeoff, stated plainly.** Anything running in the page's origin (an XSS payload, a malicious extension with page access) could read `localStorage` where it could previously only read process memory — and unlike the interim `sessionStorage` posture, the token now also persists across browser restarts until its TTL, so the exposure window is the token's remaining lifetime rather than the tab's. That is a real widening, bounded by the token's own properties: it is opaque, TTL-bounded, scoped to marketplace commands for one account, hashed at rest on the service, and revoked by sign-out or expiry. We judge that acceptable against the alternative of retraining users to re-approve on every reload, new tab, and restart.

## Where the chat inbox session lives in the browser

The encrypted-messaging session of the retired Paykit Encrypted Links transport (a Ring-approved `/pub/paykit/:rw` session export under `pubky.messaging.session.v1`) is gone with that transport. The chat that replaced it ([`../chat/README.md`](../chat/README.md)) needs no separate homeserver session: it reads and writes through the signed-in session's own grant (`/pub/chat/:rw`, `/priv/chat/:rw`).

The one chat credential kept in the browser is the **inbox bearer**. `POST /v1/auth/session` on the `pubky/inbox` service exchanges the session grant plus a custom proof-of-possession over `{ "type": "pubky-inbox-session-v1", "audience": <inbox audience> }` (grant sessions only; a cookie session has no grant to sign with) for an opaque `access_token` with an `expires_at`. It follows the marketplace bearer's posture above: in memory, mirrored to a `shop-` namespaced `localStorage` key (`chat-inbox-session:v1`) so every tab of the account shares one session, dropped 60 s before expiry and on a 401, ended with `DELETE /v1/auth/session` (best effort) on sign-out, and never kept for another account after an identity switch. It authorizes pings and the long-poll only; it carries no homeserver capability and cannot read a message.

## Version interoperability, measured

The service verifies with the Rust crate `pubky-common`, pinned to `=0.11.0`. This app ships `@synonymdev/pubky` **0.8.0**. Those are three minor versions apart, and the crate's signature serialization was refactored in between (0.8 relies on the default `Signature` serde; 0.11 uses a custom fixed-64-byte module). That raised an obvious risk: tokens produced around the client's version failing verification at the service.

It does not happen. Tested against the real implementations rather than reasoned about:

| Token minted by       | Verified by                          | Result   |
| --------------------- | ------------------------------------ | -------- |
| `pubky-common` 0.8.0  | `pubky-common` 0.11.0                | verifies |
| `pubky-common` 0.11.0 | `@synonymdev/pubky` 0.8.0 (this app) | verifies |

Both directions round-trip, so the serde refactor preserved the wire format. The exact pin is still worth keeping — it makes any future format change a deliberate, visible upgrade rather than a silent break — but the client and service do **not** have to move in lockstep today.

Reproduce by minting a token with `AuthToken::sign` under each crate version and cross-verifying with `AuthToken::verify` and the SDK's `AuthToken.verify`.

## Consequence to weigh

`awaitToken()` requires a signer approval. If the marketplace session is established separately from the app's existing sign-in, the user sees a second Pubky Ring prompt the first time they do something transactional.

That is a real UX cost and it is a product decision, not a technical one. Two directions:

- **Accept it.** A distinct approval for "this app may transact on my behalf in the marketplace" is arguably the honest thing to show a user, and it keeps marketplace authority scoped separately from social write access.
- **Fold it into sign-in.** Request the marketplace capability during the existing auth flow so there is one approval. Cheaper UX, but it grants marketplace authority to every user at sign-in whether or not they ever use it.

The transport no longer waits on this decision: in `transaction-service` mode the client establishes sessions exactly as designed above (`MarketplaceSessionService.beginSessionFlow()` starts the flow, `awaitToken()` bytes are exchanged at `/v1/auth/sessions`, the bearer lives in memory with a per-tab `sessionStorage` mirror — see "Where the bearer token lives in the browser" — and dies on sign-out), and commands execute against the durable service — verified end to end by `npm run test:marketplace:service`. The in-app approval prompt exists too: `MarketplaceSessionConnectDialog` renders the flow's `pubkyauth://` URL as a QR/deeplink for Pubky Ring, and every durable-mode surface that hits the session requirement offers it (see [`status.md`](status.md)). That UI implements the **separate-approval** direction; whether the grant should instead fold into sign-in — and the wider capability-scoping questions above — remain the open product decision this document records.

## What is not affected

Publishing shops, listings, and media is unrelated — those are signed homeserver writes using the app's existing session and `/pub/pubky.app/:rw` grant. They work today and need no new authentication.
