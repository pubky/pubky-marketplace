# Shop grant authentication and App-owned sessions

Shop homeserver authentication uses SDK 0.16.2 grant sessions in both standalone Shop and the same-origin App integration. App Shop navigation always opens `/shop` around the Shop iframe, which consumes App's grant. There is no App enable flag or `PUBKY_RUNTIME_SHOP_URL` fallback. Deployment instructions are in [Shop embedding](shop-embedding.md).

## Standalone sign-in and migration

| Entry point | Session established |
|---|---|
| Pubky Ring | Delegated `signin_grant`, recorded with signer `ring` |
| Bitkit | Delegated `signin_grant`, recorded with signer `bitkit` |
| Pubky Passport | Delegated `signin_grant`, recorded with signer `passport`; the popup opens synchronously from a click |
| Recovery phrase or encrypted recovery file | SDK root grant under the configured Shop client ID, recorded with signer `local-key` |
| Ring signup | SDK `signup_grant`, followed by grant session initialization |
| Locally generated account signup | Account registration and PKDNS publication, then SDK grant sign-in |

External signer requests use `approvalFormat: 'bareGrant'` and request `/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw`. Existing grants need only the three core Shop trees (`/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw`) to open Shop. The Chat scopes prepare for the separate [#209](https://github.com/pubky/pubky-marketplace/pull/209) consumer; its permission-upgrade handling is not implemented by this integration. SDK direct key sign-in returns root storage permission `/:rw`, which covers the required paths. Neither path requests encryption-key action `e`. Staging account registration still uses the homeserver's signup protocol, but ignores any returned cookie session and establishes a grant before authenticating the browser.

A persisted grant restores by its exact SDK `BrowserSessionStore` record ID. If sign-in saved the grant but profile discovery or bootstrap was interrupted, restore retries those steps before completing authentication; a temporary failure keeps the record available for retry. Grant sign-in requires usable secure browser storage, WebCrypto and Web Locks. A missing capability, unsupported browser or blocked storage produces an explicit unavailable/retry state rather than a cookie fallback. Temporary storage or network failures retain the saved reference; definitive missing or invalid credentials require a new approval.

Generated-account signup retains the recovery secret after failure, including when registration consumed the invite before grant saving finished. Retrying can sign in with that same key. The secret is cleared only after backup or explicit onboarding abandonment/logout.

Existing cookie-only users must sign in again; retained identity metadata does not render signed-in navigation. Shop does not restore a legacy exported session, fragment handoff or homeserver cookie as authority. Detecting that migration does not delete local message history. A successful same-account replacement keeps that history; an explicit sign-out or account change still applies account cleanup. Keep the obsolete `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` consumer settings unset. Browser data from a standalone Shop origin does not move to the App origin.

## Ownership and cleanup

Standalone Shop creates and retires its own grants under `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID`, which defaults to `shop.pubky.app`. It removes only exact owned session records and pending delegated keys. It never uses the SDK's origin-wide `clear()` or `clearAll()` to sign out, because `pubky-auth` can also contain App sessions.

Coordinate SDK versions in App and Shop and rerun the ownership and persistence contract tests before deploying the compatible pair. Deploy both frontends with the proxy and configured BFF, and pass the [deployment preflight](shop-embedding.md#deployment-preflight-and-outage-recovery) before sending users to the release. Follow the [coordinated SDK release checklist](../ecommerce/release.md#grant-sdk-and-embedded-release-requirements).

SDK 0.16.2 has no public API for removing a single pending delegated-flow key. A small compatibility adapter uses the key ID returned by that Shop flow's `saveDelegated()` and deletes only that key in the pinned SDK database schema. Durable cleanup markers contain public IDs, not credentials. Failed removal keeps the obligation for retry. Live delegated flows hold an exact-key Web Lock, so another tab cannot mistake the relay retention timeout for an abandoned approval. Cleanup rechecks the marker after acquiring the lock, protecting a flow that committed while cleanup was queued. The real-SDK contract tests must be rerun before changing SDK versions or its persistence schema; unknown schemas must fail closed rather than enumerate or erase other keys.

There is an SDK-level crash window: `startDelegated()` saves a key before returning its ID to Shop. A browser crash before Shop records that ID can leave an untracked pending key. The adapter does not enumerate unrelated keys to recover it; eliminating that window requires an SDK ownership/cleanup contract.

Before a standalone reapproval replaces its saved reference, Shop records a durable retirement obligation for the old grant. Cleanup revokes that exact grant while its proof key still exists, then removes the record. Failed revocation or removal retains the obligation; active references and App-owned records are excluded. SDK 0.16.2 terminal missing, invalid and signed-out session states finish local retirement. Network failures retain the proof key for revocation retry. Each obligation is attempted independently; explicit logout still clears local account and service access when older cleanup cannot finish. A local-removal marker never overrides an unresolved revocation obligation. A logout captures the live grant and any same-account replacement already persisted when the user clicks sign out. Both are retired; a grant committed after that click remains protected. Other tabs adopt a same-account renewal before resuming authenticated requests.

The embedded Shop is a consumer of the App's grant. Hosted activation checks the profile directly on the homeserver; it does not run the social Nexus bootstrap under the shared cleanup lock. Shop profile and watchlist views fetch their own data. App alone creates, replaces, revokes and removes that saved record. Shop validates the exact pubky, client ID, grant ID and effective scopes before using it, and does not persist a separately restorable App-session pointer. A same-account restore preserves valid marketplace/inventory service approvals while its App cleanup epoch is unchanged, including an absent legacy epoch. App persists a public `shopCleanupEpoch` at logout and account boundaries, including when the iframe is absent. Before restoring a host reference, Shop compares that boundary against `shop-host-cleanup-epoch-v1`, clears private and service state on a mismatch, then acknowledges successful cleanup. The first missing acknowledgment also triggers cleanup for legacy hosts. App and Shop serialize this work with `pubky-shop-host-cleanup`; Shop rechecks App’s durable generation, identity and epoch before adopting the reference.

After a durably persisted logout with a cleanup epoch, App makes a bounded best-effort attempt to clear the agreed Shop service credentials and private tables under Web Locks. This cleanup preserves SDK records and the owner-scoped delivery address book; App's auth controller separately retires its outgoing grant. A failed or skipped Shop cleanup leaves the epoch for Shop to retry; a tab-only logout cannot publish that durable boundary. Before adopting the host, Shop durably queues retirement of any old standalone Shop record. Sign-out or an account change cancels pending work and resets account settings and search state without removing an unrelated App record.

Host cleanup also awaits a confirmed BFF session-cookie deletion before acknowledging the epoch. Network failures, timeouts and non-success responses retain that cleanup boundary for retry; embedded activation therefore requires the mounted BFF session route to be enabled. Public catalog routes remain available after a settled failure, while account actions require restored authority. An older host snapshot cannot bypass a newer persisted epoch. A fresh guest with no saved App metadata may still complete cleanup without adopting any grant. Remote retirement of previously owned Shop grants runs from its durable exact-record obligations without blocking later host logout.

## Same-origin session bridge

The supported pair is App `/shop` around Shop `/shop-embed`, on the same scheme, hostname and port. App Shop navigation always opens the embedded Shop at `/shop`, with App navigation visible around a persistent iframe. The compatible App/Shop pair, proxy and BFF deploy together; there is no App enable flag. Invalid embedded configuration fails Shop startup. App monitors the mounted BFF readiness endpoint and automatically restores the frame after an outage; see [deployment preflight](shop-embedding.md#deployment-preflight-and-outage-recovery).

The versioned `pubky-shop-session` bridge sends only public metadata:

```text
{ generation, shopCleanupEpoch, status, pubky, sessionStoreId, grantId, clientId }
```

Both sides check the exact origin and the expected parent/iframe window. No bearer, private key, session export or cookie crosses `postMessage`. The child can request login, additional fixed Shop capabilities, logout, or a validated navigation; it cannot choose arbitrary scopes or an account. A ready handshake does not open login or signer UI. Duplicate successful snapshots do not reset an already mounted Shop. A transient local failure can retry the same snapshot; the explicit retry action also asks App to retry its own session restore. After a settled session error or missing-permission response, public routes remain browsable beside the recovery action, while protected routes and account actions remain gated.

New App Ring/Bitkit and Passport approvals include Shop/Chat storage scopes alongside App/Locks permissions. Recovery-key sign-in and browser signup obtain root storage grants. An older App grant that lacks required Shop/Chat scopes enters an explicit App-owned permission flow: the existing Ring panel offers an alternative App sign-in route for Passport or a recovery key. Expired or revoked credentials also return to App-owned reauthorization. The explicit return route is tied to the current App generation so an existing session does not immediately redirect back to Shop before a replacement approval. Every reauthorization entry point binds approval to the existing App identity before saving a replacement. The Shop login dialog is suppressed in host mode. The App owns logout; iframe teardown itself must not revoke the shared grant.

This is same-origin session reuse, not cross-origin SSO. An iframe on another origin cannot restore App's SDK IndexedDB record. Allowing another origin in `frame-ancestors` changes framing permission only. The trusted same-origin iframe is also not a security isolation boundary.

## Commerce remains a separate approval

Homeserver sign-in does not mint a marketplace service session. Commerce uses the active homeserver grant to write the bootstrap proof, then obtains the appropriate marketplace grant approval. Marketplace bearer sessions, Shop BFF cookies and Locks connections have separate approval and cleanup lifecycles. The BFF is Shop's existing Next.js server route layer; it owns the HttpOnly marketplace session and flow cookies.

Ring approvals remain Ring approvals, and Bitkit and Passport keep their own launch behavior. A hosted session exposes no signer identity, so Shop asks the user to choose Ring, Bitkit or enabled Passport explicitly. The approval must belong to the same pubky. Standalone Shop reports unavailable when grant-bootstrap support is disabled. Embedded Shop requires that configuration at startup. Normal commerce UI does not fall back to the old dual AuthToken/homeserver sign-in ceremony.

Recovery-file-only commerce remains limited: after local key sign-in, the user must approve with the **same identity** already imported into a supported external signer. Shop does not retain the recovery root key for later purchases, offer a new re-upload approval screen, or invent a backend key-proof endpoint. Inventory connects through the same marketplace grant path. Marketplace private-key release and seller Locks setup still depend on their existing service contracts.

## Messaging cutover

[Chat #209](https://github.com/pubky/pubky-marketplace/pull/209) is the separate replacement for Paykit Encrypted Links. Shop's external signer approvals and App's scoped signer approvals include `/pub/chat/v0/:rw` and `/priv/chat/v0/:rw`. App cleanup covers the planned Chat tables and Inbox credential. These entries prepare for that consumer; they do not establish a working Chat integration or permission-upgrade flow. Encryption-key action `e` remains outside this integration.

Until that separate transport lands, this branch retains the legacy messaging guard: fresh grant sessions cannot enroll in the cookie-only Paykit transport. Existing compatible local conversations remain readable. Removing the guard alone would start a separate cookie approval, not enable grant messaging.

Coordinate merge order with Matthew. The replacement must retain this branch's hosted session ownership and account-switch cleanup, handle missing Chat permissions, and clear its Inbox bearer, in-memory chat state and private tables on logout, including when App logs out with no Shop iframe mounted. Verify the shared App grant with reload, two tabs, pending sends and account changes; standalone chat tests do not establish those guarantees. Review the database/history migration policy with #209. VV and the Inbox owner supply the Inbox URL, audience and permitted origins. Paykit payment bindings remain independent of this chat replacement.

## Release verification still required

Unit, component and real-SDK contract tests cover request shape, signer choice, exact-reference restore, ownership, failure handling and mounted callback paths. They do not prove that a deployed signer, marketplace, Locks or PayPal flow completes.

The required `launch-e2e` gate uses explicit synthetic mode with no staging seller secret. It drives production UI and real SDK Shop/service grant approvals, checks the exact saved SDK record across reload, then requires bootstrap proof upload, verification and removal plus an authorized seller inventory read. PKARR, homeserver, BFF and marketplace HTTP responses are fixtures; unexpected external requests fail the test. Live mode remains opt-in and requires a grant-enabled backend.

Before releasing the deployed pair, verify:

- Desktop/mobile Shop navigation and direct `/shop` deep links load the iframe with no enable flag. Missing embedded/BFF configuration fails Shop startup. A real BFF outage shows the unavailable state; restoring BFF health automatically reloads Shop at the same URL without clearing the saved session.
- Ring, Bitkit, Passport, recovery-file/phrase and signup grants; reload and explicit sign-out; blocked IndexedDB and a failed save/removal without losing the reference or deleting another record.
- A migrated cookie account with local history; old App scopes upgraded with the same identity; rejected or wrong-account approvals; App reauthorization when Shop detects revocation before App does.
- Two App tabs and the iframe during restore, account switch, logout and a pending approval; same-account reopen without losing marketplace/inventory approvals.
- Marketplace bootstrap/reconnect, inventory, private-key release and seller Locks setup with the backend flag enabled; clear unavailability when deployment support is absent.
- Deep links, query/hash, Back/Forward, reload, and top-level signer/PayPal returns; real Safari/mobile popup and custom-scheme gestures; browser restart and service-worker behavior.
- Existing narrow App grants through both the Ring upgrade panel and its Passport/recovery-key reauthorization alternative, returning to the original Shop page after successful approval.

Backend origin allow-lists, grant-assertion trust, enabled grant-flow support, proxy deployment and real signer/payment QA must be verified on the deployed pair. Local browser and visual-regression checks do not replace those checks.
