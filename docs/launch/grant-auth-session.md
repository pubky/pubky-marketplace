# Shop grant authentication and App-owned sessions

Shop homeserver authentication now uses SDK 0.16.1 grant sessions. This applies to standalone Shop as well as the opt-in, same-origin App integration. The embedding flag controls the App shell and session owner; it does not restore the old cookie login path. Deployment instructions are in [Shop embedding](shop-embedding.md).

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

A persisted grant restores by its exact SDK `BrowserSessionStore` record ID. If sign-in saved the grant but profile discovery or bootstrap was interrupted, restore retries those steps before completing authentication; a temporary failure keeps the record available for retry. Grant sign-in requires usable secure browser storage, WebCrypto and Web Locks. A missing capability, unsupported browser or blocked storage produces an explicit unavailable/retry state rather than a cookie fallback. Temporary storage or network failures retain the saved reference; definitive missing or invalid credentials require a new approval.

Existing cookie-only users must sign in again. Shop does not restore a legacy exported session, fragment handoff or homeserver cookie as authority. Detecting that migration does not delete local message history. A successful same-account replacement keeps that history; an explicit sign-out or account change still applies account cleanup. Keep the obsolete `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` consumer settings unset. Keep the standalone site available during rollout: browser data from `shop.pubky.app` does not move to `pubky.app`.

## Ownership and cleanup

Standalone Shop creates and retires its own grants under client ID `shop.pubky.app`. It removes only exact owned session records and pending delegated keys. It never uses the SDK's origin-wide `clear()` or `clearAll()` to sign out, because `pubky-auth` can also contain App sessions.

**Upgrade the SDK in App and Shop together and rerun the ownership and persistence contract tests before release.** Follow the [coordinated SDK release checklist](../ecommerce/release.md#grant-sdk-and-embedded-release-requirements).

SDK 0.16.1 has no public API for removing a single pending delegated-flow key. A small compatibility adapter uses the key ID returned by that Shop flow's `saveDelegated()` and deletes only that key in the pinned SDK database schema. Durable cleanup markers contain public IDs, not credentials. Failed removal keeps the obligation for retry. Live delegated flows hold an exact-key Web Lock, so another tab cannot mistake the relay retention timeout for an abandoned approval. Cleanup rechecks the marker after acquiring the lock, protecting a flow that committed while cleanup was queued. The real-SDK contract tests must be rerun before changing SDK versions or its persistence schema; unknown schemas must fail closed rather than enumerate or erase other keys.

There is an SDK-level crash window: `startDelegated()` saves a key before returning its ID to Shop. A browser crash before Shop records that ID can leave an untracked pending key. The adapter does not enumerate unrelated keys to recover it; eliminating that window requires an SDK ownership/cleanup contract.

Before a standalone reapproval replaces its saved reference, Shop records a durable retirement obligation for the old grant. Cleanup revokes that exact grant while its proof key still exists, then removes the record. Failed revocation or removal retains the obligation; active references and App-owned records are excluded. SDK 0.16.1 terminal missing, invalid and signed-out session states finish local retirement. Network failures retain the proof key for revocation retry. Each obligation is attempted independently; explicit logout still clears local account and service access when older cleanup cannot finish. A local-removal marker never overrides an unresolved revocation obligation. A delayed logout cannot clear a newer grant, including a replacement for the same account.

The embedded Shop is a consumer of the App's grant. App alone creates, replaces, revokes and removes that saved record. Shop validates the exact pubky, client ID, grant ID and effective scopes before using it, and does not persist a separately restorable App-session pointer. A same-account restore preserves valid marketplace/inventory service approvals while its App cleanup epoch is unchanged. App persists a public `shopCleanupEpoch` at logout and account boundaries, including when the iframe is absent. Before restoring a host reference, Shop compares that boundary against `shop-host-cleanup-epoch-v1`, clears private and service state on a mismatch, then acknowledges successful cleanup. The first missing acknowledgment also triggers cleanup for legacy hosts. App and Shop serialize this work with `pubky-shop-host-cleanup`; Shop rechecks App’s durable generation, identity and epoch before adopting the reference. After a durably persisted logout, App makes a bounded best-effort attempt to clear the agreed Shop service credentials and private tables under Web Locks, preserving the shared SDK database and owner-scoped delivery address book. A failed or skipped attempt leaves the epoch for Shop to retry; a tab-only logout cannot publish that durable boundary. Before adopting the host, Shop durably queues retirement of any old standalone Shop record. Sign-out or an account change cancels pending work and resets account settings and search state without removing another App record.

Host cleanup also awaits a confirmed BFF session-cookie deletion before acknowledging the epoch. Network failures, timeouts and non-success responses retain that cleanup boundary for retry; embedded activation therefore requires the mounted BFF session route to be enabled. Public catalog routes remain available after a settled failure, while account actions require restored authority. An older host snapshot cannot bypass a newer persisted epoch. A fresh guest with no saved App metadata may still complete cleanup without adopting any grant. Remote retirement of previously owned Shop grants runs from its durable exact-record obligations without blocking later host logout.

## Same-origin session bridge

The supported pair is App `/shop` around Shop `/shop-embed`, on the same scheme, hostname and port. App navigation remains visible around a persistent Shop iframe. The opt-in App flag is `PUBKY_RUNTIME_SHOP_EMBED_ENABLED=true`; with it disabled, App retains the configured external Shop link.

The versioned `pubky-shop-session` bridge sends only public metadata:

```text
{ generation, shopCleanupEpoch, status, pubky, sessionStoreId, grantId, clientId }
```

Both sides check the exact origin and the expected parent/iframe window. No bearer, private key, session export or cookie crosses `postMessage`. The child can request login, additional fixed Shop capabilities, logout, or a validated navigation; it cannot choose arbitrary scopes or an account. A ready handshake does not open login or signer UI. Duplicate successful snapshots do not reset an already mounted Shop. A transient local failure can retry the same snapshot; the explicit retry action also asks App to retry its own session restore. After a settled session error or missing-permission response, public routes remain browsable beside the recovery action, while protected routes and account actions remain gated.

New App approvals include Shop storage scopes while embedding is enabled, preserving App/Locks permissions. An older grant that lacks Shop access enters an explicit App-owned permission flow: the existing Ring panel offers an alternative App sign-in route for Passport or a recovery key. Expired or revoked credentials also return to App-owned reauthorization. The explicit return route is tied to the current App generation so an existing session does not immediately redirect back to Shop before a replacement approval. The Shop login dialog is suppressed in host mode. The App owns logout; iframe teardown itself must not revoke the shared grant.

This is same-origin session reuse, not cross-origin SSO. An iframe on another origin cannot restore App's SDK IndexedDB record. Allowing another origin in `frame-ancestors` changes framing permission only. The trusted same-origin iframe is also not a security isolation boundary.

## Commerce remains a separate approval

Homeserver sign-in does not mint a marketplace service session. Commerce uses the active homeserver grant to write the bootstrap proof, then obtains the appropriate marketplace grant approval. Existing marketplace bearer sessions, Shop BFF cookies and Locks connections remain separate service credentials. Keep them; removing homeserver cookie login does not mean removing all cookies.

Ring approvals remain Ring approvals, and Bitkit and Passport keep their own launch behavior. A hosted session exposes no signer identity, so Shop asks the user to choose Ring, Bitkit or enabled Passport explicitly. The approval must belong to the same pubky. Disabled grant-bootstrap deployment support produces an unavailable state; normal commerce UI does not fall back to the old dual AuthToken/homeserver sign-in ceremony.

Recovery-file-only commerce remains limited: after local key sign-in, the user must approve with the **same identity** already imported into a supported external signer. Shop does not retain the recovery root key for later purchases, offer a new re-upload approval screen, or invent a backend key-proof endpoint. Inventory connects through the same marketplace grant path. Marketplace private-key release and seller Locks setup still depend on their existing service contracts.

Matthew is replacing the legacy chat transport with the Inbox integration; this auth/embed work assumes that replacement will be completed in parallel. The vendored Paykit WASM (`0.1.0-rc50`, source `d4a73a5765e1f0b18ed451d78f98dab97c611a8c`) can construct only cookie-backed `SessionHandle` objects. Its encrypted-link operations require those handles; it has no API to import SDK 0.16 grants or inject a grant-authorized transport. Removing the UI guard would start a separate legacy Ring cookie approval, not grant messaging, so the guard stays. All current sign-in methods use grants: changing signers does not resolve this limitation. Existing valid messaging cookies can still resume, and local encrypted conversations remain readable.

Coordinate the reviewable replacement branch and its required scopes/configuration with Matthew (frontend) and Severin (Inbox), with John owning the launch decision. Verify fresh profiles with no homeserver cookie for Ring, Bitkit, Passport, recovery and hosted grants; same-account restore; logout/account switch and pending sends; and an explicit compatibility plan for device-local message history, Noise keys, link snapshots, queued outbox and listing conversation IDs. Preserve the existing data/key pair until there is a tested readable legacy view or migration. This change does not invent a WASM adapter, request `e`, upgrade the Paykit dependency, or remove the old transport before its replacement is ready.

## Release verification still required

Unit, component and real-SDK contract tests cover request shape, signer choice, exact-reference restore, ownership, failure handling and mounted callback paths. They do not prove that a deployed signer, marketplace, Locks or PayPal flow completes.

On 2026-10-13, rebuilt App/Shop production artifacts using SDK 0.16.1 restored genuine records created by published SDK 0.16.0 in Chromium and WebKit. Restore/reload, two tabs, App logout with both Shop iframes absent, and no revival after remount/reload passed. Chromium also passed temporary-renewal recovery for an old record and BFF HTTP 503 cleanup failure followed by explicit HTTP 204 retry. Synthetic cross-origin popups from App and framed Shop retained their opener through the actual mounted Passport callback in both browsers; the no-opener fallback also passed. No browser page errors occurred.

These checks used real SDK/WASM and browser IndexedDB with a synthetic identity and intercepted network responses. The popup probe tested callback/header behavior, not the production Passport button or deployed Passport headers. Real staging backend availability, mobile signer gestures and payment completion remain unverified. SDK upgrades require a fresh run of the release checklist above.

The marketplace session-connect visual regression passed in Linux Chromium and Firefox, with a second comparison against the updated baselines; Darwin Chromium also passed. Its Ring/Bitkit approval, signer choice, Passport popup and unavailable-backend scenes use fixtures and do not exercise live approvals.

The required `launch-e2e` gate uses explicit synthetic mode with no staging seller secret. It drives production UI and real SDK Shop/service grant approvals, checks the exact saved SDK record across reload, then requires bootstrap proof upload, verification and removal plus an authorized seller inventory read. PKARR, homeserver, BFF and marketplace HTTP responses are fixtures; unexpected external requests fail the test. Live mode remains opt-in and requires a grant-enabled backend.

Before enabling the deployed pair, verify:

- Ring, Bitkit, Passport, recovery-file/phrase and signup grants; reload and explicit sign-out; blocked IndexedDB and a failed save/removal without losing the reference or deleting another record.
- A migrated cookie account with local history; old App scopes upgraded with the same identity; rejected or wrong-account approvals; App reauthorization when Shop detects revocation before App does.
- Two App tabs and the iframe during restore, account switch, logout and a pending approval; same-account reopen without losing marketplace/inventory approvals.
- Marketplace bootstrap/reconnect, inventory, private-key release and seller Locks setup with the backend flag enabled; clear unavailability when deployment support is absent.
- Deep links, query/hash, Back/Forward, reload, and top-level signer/PayPal returns; real Safari/mobile popup and custom-scheme gestures; browser restart and service-worker behavior.
- Existing narrow App grants through both the Ring upgrade panel and its Passport/recovery-key reauthorization alternative, returning to the original Shop page after successful approval.

Backend origin allow-lists, grant-assertion trust, enabled grant-flow support, proxy deployment and real signer/payment QA must be verified on the deployed pair. Local browser and visual-regression checks do not replace those checks.
