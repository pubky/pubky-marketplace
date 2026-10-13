# Shop grant authentication and App-owned sessions

Shop homeserver authentication now uses SDK 0.16 grant sessions. This applies to standalone Shop as well as the opt-in, same-origin App integration. The embedding flag controls the App shell and session owner; it does not restore the old cookie login path. Deployment instructions are in [Shop embedding](shop-embedding.md).

## Standalone sign-in and migration

| Entry point | Session established |
|---|---|
| Pubky Ring | Delegated `signin_grant`, recorded with signer `ring` |
| Bitkit | Delegated `signin_grant`, recorded with signer `bitkit` |
| Pubky Passport | Delegated `signin_grant`, recorded with signer `passport`; the popup opens synchronously from a click |
| Recovery phrase or encrypted recovery file | SDK `Signer.signin('shop.pubky.app')`, recorded with signer `local-key` |
| Ring signup | SDK `signup_grant`, followed by grant session initialization |
| Locally generated account signup | Account registration and PKDNS publication, then SDK grant sign-in |

External signer requests use `approvalFormat: 'bareGrant'` and request `/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw`. SDK direct key sign-in returns root storage permission `/:rw`, which covers the required paths. Neither path requests encryption-key action `e`; ordinary Shop authentication does not request or recover SDK encryption keys. Staging account registration still uses the homeserver's signup protocol, but ignores any returned cookie session and establishes a grant before authenticating the browser.

A persisted grant restores by its exact SDK `BrowserSessionStore` record ID. Grant sign-in requires usable secure browser storage, WebCrypto and Web Locks. A missing capability, unsupported browser or blocked storage produces an explicit unavailable/retry state rather than a cookie fallback. Temporary storage or network failures retain the saved reference; definitive missing or invalid credentials require a new approval.

Existing cookie-only users must sign in again. Shop does not restore a legacy exported session, fragment handoff or homeserver cookie as authority. Detecting that migration does not delete local message history. A successful same-account replacement keeps that history; an explicit sign-out or account change still applies account cleanup. Keep the standalone site available during rollout: browser data from `shop.pubky.app` does not move to `pubky.app`.

## Ownership and cleanup

Standalone Shop creates and retires its own grants under client ID `shop.pubky.app`. It removes only exact owned session records and pending delegated keys. It never uses the SDK's origin-wide `clear()` or `clearAll()` to sign out, because `pubky-auth` can also contain App sessions.

SDK 0.16 has no public API for removing a single pending delegated-flow key. A small compatibility adapter uses the key ID returned by that Shop flow's `saveDelegated()` and deletes only that key in the pinned SDK database schema. Durable cleanup markers contain public IDs, not credentials. Failed removal keeps the obligation for retry. The real-SDK contract tests must be rerun before changing SDK versions or its persistence schema; unknown schemas must fail closed rather than enumerate or erase other keys.

There is an SDK-level crash window: `startDelegated()` saves a key before returning its ID to Shop. A browser crash before Shop records that ID can leave an untracked pending key. The adapter does not enumerate unrelated keys to recover it; eliminating that window requires an SDK ownership/cleanup contract.

The embedded Shop is a consumer of the App's grant. App alone creates, replaces, revokes and removes that saved record. Shop validates the exact pubky, client ID, grant ID and effective scopes before using it, and does not persist a separately restorable App-session pointer. A same-account restore preserves valid marketplace/inventory service approvals. Sign-out or an account change cancels pending work and clears Shop account state without removing another App record.

## Same-origin session bridge

The supported pair is App `/shop` around Shop `/shop-embed`, on the same scheme, hostname and port. App navigation remains visible around a persistent Shop iframe. The opt-in App flag is `PUBKY_RUNTIME_SHOP_EMBED_ENABLED=true`; with it disabled, App retains the configured external Shop link.

The versioned `pubky-shop-session` bridge sends only public metadata:

```text
{ generation, status, pubky, sessionStoreId, grantId, clientId }
```

Both sides check the exact origin and the expected parent/iframe window. No bearer, private key, session export or cookie crosses `postMessage`. The child can request login, additional fixed Shop capabilities, logout, or a validated navigation; it cannot choose arbitrary scopes or an account. A ready handshake does not open login or signer UI. Duplicate snapshots do not reset an already mounted Shop.

New App approvals include Shop storage scopes while embedding is enabled, preserving App/Locks permissions. An older grant that lacks Shop access enters an explicit App-owned permission flow: the existing Ring panel offers an alternative App sign-in route for Passport or a recovery key. Expired or revoked credentials also return to App-owned reauthorization. The explicit return route is tied to the current App generation so an existing session does not immediately redirect back to Shop before a replacement approval. The Shop login dialog is suppressed in host mode. The App owns logout; iframe teardown itself must not revoke the shared grant.

This is same-origin session reuse, not cross-origin SSO. An iframe on another origin cannot restore App's SDK IndexedDB record. Allowing another origin in `frame-ancestors` changes framing permission only. The trusted same-origin iframe is also not a security isolation boundary.

## Commerce remains a separate approval

Homeserver sign-in does not mint a marketplace service session. Commerce uses the active homeserver grant to write the bootstrap proof, then obtains the appropriate marketplace grant approval. Existing marketplace bearer sessions, Shop BFF cookies and Locks connections remain separate service credentials. Keep them; removing homeserver cookie login does not mean removing all cookies.

Ring approvals remain Ring approvals, and Bitkit and Passport keep their own launch behavior. A hosted session exposes no signer identity, so Shop asks the user to choose Ring, Bitkit or enabled Passport explicitly. The approval must belong to the same pubky. Disabled grant-bootstrap deployment support produces an unavailable state; normal commerce UI does not fall back to the old dual AuthToken/homeserver sign-in ceremony.

Recovery-file-only commerce remains limited: after local key sign-in, the user must approve with the **same identity** already imported into a supported external signer. Shop does not retain the recovery root key for later purchases, offer a new re-upload approval screen, or invent a backend key-proof endpoint. Inventory connects through the same marketplace grant path. Marketplace private-key release and seller Locks setup still depend on their existing service contracts.

Matthew's Inbox/chat work is separate. This migration does not implement a new messaging key protocol, request `e` for messaging, or remove the vendored Paykit code. Shared account lifecycle integration and existing encrypted-history recovery must be verified with that work before release.

## Release verification still required

Unit, component and real-SDK contract tests cover request shape, signer choice, exact-reference restore, ownership, failure handling and mounted callback paths. They do not prove that a deployed signer, marketplace, Locks or PayPal flow completes.

On 2026-10-13, the local production App/Shop pair passed unsigned and authenticated same-origin browser checks through `/shop` and `/shop-embed`. The authenticated checks use the actual SDK 0.16/WASM and browser IndexedDB with a synthetic identity and intercepted network responses. They verify shared exact-record restore, reload, two App tabs using one SDK session exchange, App-owned logout without resurrection, deleted-record reauthorization and recovery after a temporary renewal failure. They do not establish deployed signer or payment completion. Standalone catalog SSR and cross-frame cleanup/bootstrap ordering have regression tests. The complete Shop unit suite passed 17,740 tests (two skipped); lint, formatting and the mounted production build passed.

The focused marketplace session-connect visual regression passed all 16 scenes in Linux Chromium and Firefox, with the updated baselines checked by a second comparison run. Darwin Chromium also passed. These scenes cover Ring/Bitkit approval, explicit signer choice, Passport's popup action and an unavailable grant deployment; they do not exercise a live approval.

Before enabling the deployed pair, verify:

- Ring, Bitkit, Passport, recovery-file/phrase and signup grants; reload and explicit sign-out; blocked IndexedDB and a failed save/removal without losing the reference or deleting another record.
- A migrated cookie account with local history; old App scopes upgraded with the same identity; rejected or wrong-account approvals; App reauthorization when Shop detects revocation before App does.
- Two App tabs and the iframe during restore, account switch, logout and a pending approval; same-account reopen without losing marketplace/inventory approvals.
- Marketplace bootstrap/reconnect, inventory, private-key release and seller Locks setup with the backend flag enabled; clear unavailability when deployment support is absent.
- Deep links, query/hash, Back/Forward, reload, and top-level signer/PayPal returns; real Safari/mobile popup and custom-scheme gestures; browser restart and service-worker behavior.
- Existing narrow App grants through both the Ring upgrade panel and its Passport/recovery-key reauthorization alternative, returning to the original Shop page after successful approval.

At verification time, the public staging configuration still had `marketplaceGrantFlowEnabled=false`. Backend origin allow-lists, grant-assertion trust, enabling the supported grant flow, proxy deployment and real signer/payment QA remain rollout work. Local browser and visual-regression checks do not replace those checks.
