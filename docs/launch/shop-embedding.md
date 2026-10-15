# Serving the Shop inside pubky.app

The integration keeps the App shell at `https://pubky.app/shop` and proxies the separately deployed Shop under `https://pubky.app/shop-embed`. The App owns the shared homeserver grant; Shop restores its exact SDK record on that origin. This guide describes configuration and verification. See [Grant authentication and App-owned sessions](grant-auth-session.md) for sign-in, migration, ownership and commerce behavior.

App Shop navigation always opens the embedded Shop at `/shop`; there is no App enable flag or external fallback. Deploy compatible App and Shop builds together with the reverse proxy and configured BFF. App checks the mounted BFF's readiness and automatically recovers from an outage without asking the user to reload. Standalone Shop remains supported with grant authentication and namespaced browser storage.

## Environment keys this change adds

| Key | Kind | Default | Meaning |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | build | empty | Shop mount path; use `/shop-embed` for the App integration. Leading slash, no trailing slash. Baked into the build by Next.js, so changing it needs a rebuild. In Docker, pass it as a build arg. |
| `NEXT_PUBLIC_ASSET_PREFIX` | build | unset | Optional prefix for `/_next/*` assets: a path such as `/shop-static`, or an absolute `https://` CDN URL. Unset keeps the Next.js default (the base path). |
| `NEXT_PUBLIC_DB_NAME` | build | `shop-franky` | Dexie database name. Was `franky`. Leave it at the default. |
| `PUBKY_RUNTIME_FRAME_ANCESTORS` | runtime | unset | Origins allowed to frame the Shop. Space- or comma-separated exact origins and the `'self'` keyword. Unset denies framing everywhere. Read from server runtime configuration and memoized; restart the server after changes. |
| `PUBKY_RUNTIME_EMBEDDED` | runtime | `false` | Force the embedded layout and behaviour even when the page is not detected as framed. Use it on a deployment that exists only to be embedded, so server-rendered HTML is already the embedded layout. |
| `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY` | runtime | derived | Whether this origin's old storage names (`franky`, `auth-store`, ...) are the Shop's, so they are migrated. Unset means yes when `NEXT_PUBLIC_BASE_PATH` is empty and no when it is set. |
| `PUBKY_RUNTIME_SHOP_PUBLIC_PATH` | runtime | unset | The path people use to reach the Shop when it is not the mount path: `/shop` when the App owns `/shop` and frames this build at `/shop-embed`. Share links, canonical and Open Graph URLs and structured data use it. Unset means the mount path. See [Who owns `/shop`](#who-owns-shop). |
| `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID` | runtime | `shop.pubky.app` | The client ID shown by signers for standalone Shop grant sign-in (`cid=` in the `signin_grant` link): a bare host name, no scheme, port or path. Hosted Shop restores the client ID supplied by App; this setting does not relabel App grants. |

`PUBKY_RUNTIME_DEFAULT_URL` stays the site **origin** (`https://pubky.app`). The public path (or mount path when no override is set) is appended where a public URL is built (canonical links, structured data, share links).

Invalid values fail the build (build keys) or startup (runtime keys), not silently.

## Who owns `/shop`

There are two shapes. The rest of this page applies to both unless it says otherwise.

- **Direct.** A separate deployment can serve Shop at `/shop` (`NEXT_PUBLIC_BASE_PATH=/shop`, `PUBKY_RUNTIME_EMBEDDED=false`), with its proxy sending `/shop` to Shop. The mount path and public path are the same. A standalone Shop at its origin root uses an empty base path.
- **App-owned (the pubky.app integration).** The App owns `/shop`: it renders its own chrome around a same-origin iframe, and the Shop build runs at `/shop-embed` (`NEXT_PUBLIC_BASE_PATH=/shop-embed`, `PUBKY_RUNTIME_EMBEDDED=true`, `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY=false`, `PUBKY_RUNTIME_FRAME_ANCESTORS=self`), proxied with the prefix kept. Set `PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop`. The App guide is [`docs/shop-embedding.md` in pubky-app](https://github.com/pubky/pubky-app/blob/77634e8d32d4103b0e4aad74ea3abd778a7f06f3/docs/shop-embedding.md).

In the App-owned shape every URL has one of two homes:

| URL | Path | Why |
|---|---|---|
| Assets, `/api/*` calls, `history.replaceState` inside the frame | `/shop-embed` (mount path) | The iframe requests them itself. |
| Passport popup return (`/auth/passport/return`) | `/shop-embed` | The popup must load the Shop page so it has a `window.opener` to message. Inside the App's wrapper it would sit in an iframe with none. |
| Ring and Bitkit deep links (`pubkyring://`, `bitkit://`) | none | They carry the authorization URL and no Shop URL; the Shop hands them to the top window with `navigateTop` and the user returns to the tab they left. |
| PayPal `return` and `cancel_return` | `/shop` (public path) | A top-level page load. The service builds them as `{PUBLIC_APP_ORIGIN}/marketplace/orders`, so `PUBLIC_APP_ORIGIN=https://pubky.app/shop`: the buyer lands in the App's chrome, which frames `/shop-embed/marketplace/orders`. |
| Share links (listing, drop, post, profile), report links | `/shop` (public path) | Public links target the wrapper directly, avoiding the mount-to-wrapper redirect. |
| Canonical, Open Graph and structured-data URLs | `/shop` (public path) | Search engines and link previews should index the App's page. |

Code uses `withBasePath` for the first group and `withPublicPath` (`@/config/base-path`) for the rest. [Install verification](install-verification.md) checks it from outside with `SHOP_EMBED_PATH=/shop-embed` and `SERVICE_PUBLIC_APP_ORIGIN`; the standalone launch-critical suite needs a root or direct-mount build started with `PUBKY_RUNTIME_EMBEDDED=false`, because it clicks the standalone header. An image built at `/shop-embed` must start in embedded mode; use the paired App/Shop tests for that deployment.

For the App pair, build Shop with `NEXT_PUBLIC_BASE_PATH=/shop-embed`, set `PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop`, `PUBKY_RUNTIME_EMBEDDED=true`, `PUBKY_RUNTIME_FRAME_ANCESTORS=self`, `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY=false`, and `PUBKY_RUNTIME_DEFAULT_URL` to the App origin. Both deployments must use the same homeserver network. Keep the App's auth client ID stable. Verify the mounted BFF readiness endpoint before routing users to the paired deployment; there is no App flag to turn on afterward.

## Running with next start without Docker

The public build-time values must be present for `next build`. Keep the same values in the `next start` environment because Next also loads its configuration at startup. This example uses the database version in `.env.example`; use the version selected by the Shop release. The supported 4 → 5 → 6 → 7 → 8 schema chain migrates in place; other version mismatches can recreate the database.

```bash
NEXT_PUBLIC_BASE_PATH=/shop-embed \
NEXT_PUBLIC_DB_NAME=shop-franky \
NEXT_PUBLIC_DB_VERSION=8 \
npm run build

# Supply all required network values and BFF secrets through the process
# environment or an untracked .env.production.local before starting.
NEXT_PUBLIC_BASE_PATH=/shop-embed \
NEXT_PUBLIC_DB_NAME=shop-franky \
NEXT_PUBLIC_DB_VERSION=8 \
PUBKY_RUNTIME_EMBEDDED=true \
PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop \
PUBKY_RUNTIME_FRAME_ANCESTORS=self \
PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY=false \
PUBKY_RUNTIME_DEFAULT_URL=https://staging.pubky.app \
npm run start
```

This example intentionally does not invent the deployment's network values or secrets. Production-mode startup requires `PUBKY_RUNTIME_ENV`, `PUBKY_RUNTIME_TESTNET`, `PUBKY_RUNTIME_NEXUS_URL`, `PUBKY_RUNTIME_CDN_URL`, `PUBKY_RUNTIME_HOMESERVER`, `PUBKY_RUNTIME_HOMESERVER_URL`, `PUBKY_RUNTIME_HOMEGATE_URL`, `PUBKY_RUNTIME_DEFAULT_HTTP_RELAY` and JSON-array `PUBKY_RUNTIME_PKARR_RELAYS`; commerce also needs its service/mode configuration and the [BFF prerequisites](#shop-bff-prerequisites). Use the same network as App. See [environment configuration](../environment.md) for the schema.

Outside Vercel, routes render per request and inject the running server's `PUBKY_RUNTIME_*` values into the HTML; a non-Docker production build does not freeze development defaults into that configuration. Values are memoized per server process, so restart after changing runtime environment values. Changing `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_DB_NAME`, `NEXT_PUBLIC_DB_VERSION` or another public build-time value requires rebuilding. On Vercel, prerendered HTML uses the deployment build environment, so change configuration through a new deployment.

## The reverse proxy

Route `/shop` and `/shop/*` to **App**. Route `/shop-embed` and `/shop-embed/*` to **Shop**, preserving the prefix for documents, APIs, assets and callbacks. The browser-facing scheme, hostname and port must match. Do not redirect the iframe to `shop.pubky.app`: that loses shared IndexedDB access.

- **Static assets.** `/shop-embed/_next/static/*` can be cached according to its immutable response headers. If `NEXT_PUBLIC_ASSET_PREFIX` is set to a path, route that path too.
- **HTML and API.** Do not cache Shop HTML or `/shop-embed/api/*`. Preserve request bodies, query strings, `Set-Cookie` and backend cache headers.
- **Headers.** Pass `Host` and `X-Forwarded-Proto: https` through. The Shop's grant bridge checks the browser `Origin` against its allow-list, so `Origin` must arrive unmodified. Preserve `Sec-Fetch-Site` for the browser request checks. Set `SHOP_BFF_CLI_TRUSTED_PROXY_COUNT` to the actual trusted proxy count and ensure those proxies sanitize/populate `X-Forwarded-For`; browser bootstrap also uses this setting for per-IP rate limits. The default `0` ignores forwarded addresses and groups requests in one fallback bucket.
- **Cookies.** The Shop's bridge cookies, `__Host-shop-bff-session` and `__Host-shop-marketplace-grant`, use `Secure`, `HttpOnly`, `SameSite=Strict` and `Path=/`. On `pubky.app` they are sent to App routes too; reserve those names for Shop. App asks the mounted Shop BFF to clear them at logout.
- **Entry.** App `/shop` opens `/shop-embed/marketplace` in its iframe. The Shop root redirect stays within its configured mount.
- **Vercel cron.** If the embedded build runs on Vercel, the cron in `vercel.json` (`/api/marketplace/grant-cleanup`) must point at `/shop-embed/api/marketplace/grant-cleanup` in that deployment's config.
- **Docker cleanup.** `vercel.json` does not schedule jobs for Docker. Configure an external scheduler to call `GET /shop-embed/api/marketplace/grant-cleanup` every minute with `Authorization: Bearer <CRON_SECRET>`, through a route that reaches the Shop BFF. Verify HTTP 200 and `{"ok":true}`; account for any staging edge authentication separately.
- **Socials.** Leave `NEXT_PUBLIC_SOCIAL_HOST` unset in the embedded build. With it set, `/shop-embed/home` and the other social routes answer a 307 to the App and would load the App inside the frame.

The Shop exposes no manifest and registers no service worker under a base path (see [Service worker](#service-worker)), so the App's manifest and worker are the only ones on the origin.

## Framing and the host page

The Shop sets these framing headers. COOP applies only to standalone responses; embedded responses omit it, including Passport returns:

```
Content-Security-Policy: frame-ancestors <PUBKY_RUNTIME_FRAME_ANCESTORS, or 'none'>
Cross-Origin-Opener-Policy: same-origin-allow-popups (standalone only)
X-Frame-Options: DENY            (only when no ancestor is allowed)
X-Frame-Options: SAMEORIGIN      (only when the list is exactly 'self')
```

For the same-origin iframe, set `PUBKY_RUNTIME_FRAME_ANCESTORS=self`; the parser also accepts the quoted CSP keyword `'self'`. Additional exact origins can be allowed for layout embedding, but do not enable session sharing with those origins. Wildcards, paths and `'none'` are rejected.

On the App's side:

- **Its own CSP.** If the App ships `frame-src` or `child-src`, it must allow `'self'`.
- **The iframe element.** A same-origin iframe needs no `sandbox`. If the App adds one anyway, it must include `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-top-navigation-to-custom-protocols`, or the Shop cannot leave the frame (see [Leaving the frame](#leaving-the-frame)). Add `allow="clipboard-write"` so copy buttons work.
- **Initial URL.** The implemented App wrapper uses `src="/shop-embed/marketplace"` for `/shop`, retaining a persistent iframe as nested Shop routes change.
- **Inner path in the outer URL.** App `/shop/<path>` maps to Shop `/shop-embed/<path>`. The checked navigation bridge preserves query strings and fragments. Child navigation replaces the outer entry; outer navigation replaces the iframe location to avoid a second joint-history entry. The reserved `/api` and `/_next` paths are not accepted as wrapper destinations.
- **Returns that land top-level.** A top-level visit to `/shop-embed/...` redirects back into `/shop/...`, preserving search and hash, before restoring an account. The mounted Passport return page is exempt so it can notify its popup opener. Real signer and PayPal return journeys still need deployed QA.
- **Authentication.** The same-origin host owns sign-in, capability upgrades and logout. Shop's login dialog defers to App, and the public-metadata handshake never opens a signer on its own. No credential or session export is passed through the bridge.

## Allowed origins on the backing services

At launch the Shop is served at `https://pubky.app/shop` (staging: `https://staging.pubky.app/shop`). Every allow-list below holds **origins only**: scheme and host, no path, no trailing slash. `https://pubky.app/shop` is rejected by Locks and by the Shop's own config, and Paykit and the service compare the origin of the URL they are given. The outer `/shop` route is used for buyer-facing returns. The inner `/shop-embed` base path is used for Shop APIs, assets and Passport popup callbacks.

Standalone Shop deployments keep their own origins in the backing services' allow-lists for as long as they are served. Any redirect from a standalone hostname to App `/shop` is a separate deployment change; browser storage remains on its original origin. Development instances likewise retain their own permitted origins.

| Service | Setting | Production | Staging |
|---|---|---|---|
| Marketplace service | `ALLOWED_ORIGINS` (CORS, comma separated) | `https://pubky.app` | `https://staging.pubky.app` |
| Marketplace service | `PUBLIC_APP_ORIGIN` (PayPal `return` and `cancel_return`, the buyer lands on `{value}/marketplace/orders`) | `https://pubky.app/shop` | `https://staging.pubky.app/shop` |
| Marketplace service | `SHOP_GRANT_ASSERTION_ISSUER` | `https://pubky.app` | `https://staging.pubky.app` |
| Shop grant bridge (Shop deployment) | `SHOP_ALLOWED_ORIGINS` (JSON array) | `["https://pubky.app"]` | `["https://staging.pubky.app"]` |
| Shop grant bridge (Shop deployment) | `SHOP_PUBLIC_ORIGIN` and `SHOP_GRANT_ASSERTION_ISSUER` (equal, one origin) | `https://pubky.app` | `https://staging.pubky.app` |
| Paykit server | `[setup] allowed_origins` | `["https://pubky.app"]` | `["https://staging.pubky.app"]` |
| Lock Server | `[creator_authority_acquisition.grant_connect] allowed_return_origins` | `["https://pubky.app"]` | `["https://staging.pubky.app"]` |
| Marketplace Nexus | CORS allow-list | `https://pubky.app` | `https://staging.pubky.app` |
| Fiat verifier | CORS allow-list and `BUYER_RETURN_ORIGINS` | `https://pubky.app` | `https://staging.pubky.app` |

Notes:

- **Lock Server mode.** With `method = "grant-connect"` (the launch mode) the Lock Server reads only `grant_connect.allowed_return_origins`; the `legacy_connect` list is ignored. A server still on `legacy-connect` uses `[creator_authority_acquisition.legacy_connect] allowed_return_origins`. Neither accepts `*` in production.
- **Grant-bridge trust.** `SHOP_PUBLIC_ORIGIN` and `SHOP_GRANT_ASSERTION_ISSUER` on the Shop must be equal, and the marketplace service's `SHOP_GRANT_ASSERTION_ISSUER` must name the same origin and trust the Shop's assertion key (`SHOP_GRANT_ASSERTION_VERIFYING_KEYS_JSON`). Moving the Shop to `pubky.app` changes the issuer from `https://shop.pubky.app`; it is a trust change on the service, not only a Shop setting.
- **PayPal return.** The service builds `return` and `cancel_return` as `{PUBLIC_APP_ORIGIN}/marketplace/orders`. With the value above the buyer lands on `https://pubky.app/shop/marketplace/orders`, a full page load of the App wrapper, which opens the Shop order route in its iframe (see the `Returns that land top-level` note above). A value without `/shop` sends the buyer to a `pubky.app` route that is not the Shop. The service accepts a mount path in this one variable; see the service README.
- **Passport.** Embedded Shop responses omit COOP so the App owns the top-level opener policy, including the popup return. The fallback link carries the Shop base path. The Passport return page is `{origin}/shop-embed/auth/passport/return`; it needs no allow-list entry on our side. Passport itself accepts any HTTPS callback.
- **Development instances.** A development Shop on its own host (Vercel or Railway) lists its own origin in `SHOP_ALLOWED_ORIGINS`, `SHOP_PUBLIC_ORIGIN` and `SHOP_GRANT_ASSERTION_ISSUER`. The development services it talks to list that host in `ALLOWED_ORIGINS`, Paykit `[setup] allowed_origins`, Locks `allowed_return_origins` and the Nexus and fiat verifier CORS lists, next to `https://staging.pubky.app` when both are in use.

Run [install verification](install-verification.md) against the configured App origin. For staging, use `https://staging.pubky.app` with `SHOP_PATH=/shop/marketplace`, `SHOP_EMBED_PATH=/shop-embed` and `SERVICE_PUBLIC_APP_ORIGIN=https://staging.pubky.app/shop`: the `service.cors.*`, `wiring.*-origins`, `flow.paykit-setup.*` and `flow.locks-connect.*` checks cover these settings. Also verify the shared-session journeys in the embedded browser.

## Shop BFF prerequisites

The BFF (backend for frontend) is the Shop deployment's existing Next.js server route layer. It manages marketplace approval and its HttpOnly session/flow cookies. The embedded browser flow needs both `PUBKY_RUNTIME_MARKETPLACE_GRANT_FLOW_ENABLED=true` (client) and `SHOP_BFF_GRANT_FLOW_ENABLED=true` (server), plus the marketplace service's matching grant configuration. The App and Shop deploy together after the proxy and BFF are ready. The browser flow does not require `SHOP_BFF_CLI_GRANT_ENABLED`.

VV owns deployment values and secrets. The Shop server validates these required settings in [the BFF configuration schema](../../src/server/marketplace-grant/config.ts):

- `SHOP_BFF_GRANT_STATE_DATABASE_URL`: BFF PostgreSQL connection, with both [migration 0001](../../db/bff/0001_shop_grant_bff.sql) and [migration 0002](../../db/bff/0002_shop_grant_bff_cli.sql) applied. Browser bootstrap requires schema version 2 even when CLI authentication is disabled.
- `SHOP_ALLOWED_ORIGINS`, `SHOP_PUBLIC_ORIGIN`, `SHOP_GRANT_ASSERTION_ISSUER` and `MARKETPLACE_SERVICE_URL`: the exact origins described above; allowed origins is a JSON array and the issuer must equal the public origin.
- `SHOP_GRANT_ASSERTION_KEY_ID`, `SHOP_GRANT_ASSERTION_KEY_EPOCH`, `SHOP_GRANT_ASSERTION_SIGNING_KEY`: the assertion signing identity, matched by the marketplace service's `SHOP_GRANT_ASSERTION_VERIFYING_KEYS_JSON` trust ring.
- `MARKETPLACE_SERVICE_REQUEST_KEY_ID`, `MARKETPLACE_SERVICE_REQUEST_KEY_EPOCH`, `MARKETPLACE_SERVICE_REQUEST_SIGNING_KEY`: the service-request signing identity, matched by the service's `SHOP_BFF_REQUEST_VERIFYING_KEYS_JSON` trust ring.
- `SHOP_BFF_GRANT_STATE_ENCRYPTION_KEY_B64` and `SHOP_BFF_GRANT_STATE_KEY_EPOCH`: active BFF state encryption key and epoch. The key is 32 bytes in canonical padded Base64; signing keys above are 32-byte seeds encoded as 64 lowercase hex characters. Key epochs are positive integers.
- `CRON_SECRET`: at least 32 characters, used for the grant cleanup endpoint. Keep the mounted cleanup schedule configured as described above.

These are server-side secrets/configuration, not `NEXT_PUBLIC_*` build values. Existing working keys can be retained; embedding changes origin/trust requirements and does not itself require a key rotation. Optional rotation keys and timeout settings are defined in the linked schema.

## Deployment preflight and outage recovery

A build mounted at `/shop-embed`, or a server with `PUBKY_RUNTIME_EMBEDDED=true`, must have the complete embedded configuration at startup: matching mount and `/shop` public path, the `shop-franky` database namespace, no social-host redirect, same-origin framing, both marketplace grant flags, and valid BFF origins and secrets. Missing or invalid configuration terminates Node startup with a sanitized error. A standalone build is unaffected. Next.js invokes this check when a server instance starts, not during image compilation. Deployment preflight must start the configured instance and verify readiness before promoting it; this also applies to serverless deployments.

Use `GET /shop-embed/api/marketplace/health` through the real App origin for the deployment readiness check. It requires no identity, changes no session or cookies, creates no auth challenge, and returns:

- HTTP 200: `{"service":"pubky-shop-bff","status":"ready"}`.
- HTTP 503: `{"service":"pubky-shop-bff","status":"unavailable"}`.

Responses carry `Cache-Control: no-store, private`. The probe checks the embedded/BFF configuration and reads the PostgreSQL schema-version row, requiring version 2. Reads are bounded to at most four seconds, shared by concurrent callers, and briefly cached for one second inside each server process. The probe uses its own single-connection pool with a PostgreSQL statement timeout. A timed-out connection is closed and its query remains fenced until the database driver settles; repeated browser retries cannot queue more probes behind it. No secret, database diagnostic or user data is returned.

This confirms local Shop BFF readiness, not upstream marketplace signing-key trust, signer behavior, or payment completion. Validate those separately against the paired staging deployment. Database availability is deliberately not a startup requirement: an otherwise configured BFF returns 503 during an outage and can recover without a deployment change.

App checks this endpoint in the background while `/shop` is open. Before the frame loads, a failed check can show unavailable immediately. A loaded frame is preserved until three consecutive online checks fail, at least 10 seconds apart; offline and hidden tabs pause checks and reset that count. A healthy response restores an unavailable frame automatically. Saved grants and user sessions are not cleared by a readiness failure. Login, permission and expired-session states remain part of the existing auth UI rather than being treated as a BFF outage.

## Leaving the frame

Every flow that hands the user to another page must navigate the **top** window. Inside a frame, `window.location` would navigate only the iframe, and PayPal refuses to render in a frame.

`navigateTop(url)` in `src/libs/navigation/navigate-top.ts` is the one helper for this:

1. Not embedded, or not framed: `window.location.assign(url)`.
2. Framed, top window same origin (the `pubky.app/shop` case): `window.top.location.assign(url)`.
3. Framed, top window cross-origin: the `href` setter, the one cross-origin navigation the platform allows. Browsers want a user gesture or a sandbox flag for it and report a refusal asynchronously, so it cannot be detected.
4. Otherwise, for `http(s)` URLs, a new tab. The frame is the last resort.

### Earlier Safari findings (iOS 26.1/26.2 and macOS 26.3)

These are prior embedding observations, not a completed live test of the new shared-grant integration. Recheck the deployed pair before release.

- **Custom-scheme links.** Navigating the *frame itself* to `pubkyring://` or `bitkit://` is a silent no-op on iOS: nothing opens and nothing errors. A deep link only reaches Ring or Bitkit when it is a top-targeted navigation.
- **Gesture window.** The top-targeted navigation only works within roughly 600 ms to 1 s of the tap. Any `await`, timer or promise before it can push it outside the window, and the tap then does nothing. So `navigateTop` runs synchronously, and the click handler that calls it must not await anything first: the URL has to be in state before the tap, not fetched after it.
- **HTTPS targets.** `window.top.location.assign` to an `https://` page (PayPal checkout) works without a user gesture, so that hand-off is not time-critical.
- **Frame-denying third parties.** A page that refuses framing (`X-Frame-Options`, `frame-ancestors`) must never be loaded inside the frame. The embedded Shop therefore opens links to other origins in a new tab (`EmbeddedExternalLinks`), and sends them through `navigateTop` if the tab is blocked.

### Where it is used

- Every signer deep link, all from inside the tap handler with no async boundary before the call (each has a test that asserts this, via `navigatesWithinGesture` in `src/test-utils/user-gesture.ts`): `useMobileAuth`, `useStepUpReauth`, `useMarketplaceSessionConnect`, `useMarketplaceMessagingEnable`, `useMarketplaceInventoryGrantConnect`.
- The PayPal checkout hand-off, in the cart and accepted-offer paths.
- Social-host profile links render `target="_top"` when embedded.

The recovery-phrase "open in Ring" button (`DialogBackupExport`) still uses `window.open(url, '_blank')`: it belongs to onboarding, which the embedded Shop does not offer, and a new-tab open is a different mechanism from the frame navigation that fails.

The Paykit setup and Lock Server connect panels are nested iframes whose sandbox already grants top navigation to custom protocols. They write no `location`, so nothing changes there; see the next section for their storage limits.

## Nested cross-site frames (Paykit setup, Lock Server connect)

The Paykit setup page and the Lock Server connect page are framed *inside* the embedded Shop, and they live on other sites. On iOS Safari (verified on 26.1 and 26.2) a cross-site frame nested under the App gets:

- **Partitioned storage** (keyed by frame origin and top origin) that is **wiped on every Safari restart**. Nothing the setup or connect page stores in the frame survives a restart.
- **Blocked cookies.** Nothing that relies on a third-party cookie works there.
- **`postMessage` works.** The Shop already completes both flows over `postMessage` with an origin check; that is the only channel to rely on.

What this means for the other side:

- **Paykit setup and Lock Server connect must not depend on state kept in the frame** (cookies, localStorage, IndexedDB) across steps that can span a restart. A step that needs state must carry it in the URL it was opened with, or return it through `postMessage` to the Shop, which stores it in its own first-party storage.
- **`frame-ancestors` must admit the App origin at both depths.** The ancestor chain of a nested frame is the Shop frame and the App page; both are `https://pubky.app`, so Paykit's `[setup] allowed_origins` and the Lock Server's `allowed_return_origins` must list `https://pubky.app` (see [the table above](#allowed-origins-on-the-backing-services)). The Shop's own return origin for `postMessage` is also `https://pubky.app`.

## Embedded layout

The Shop is embedded when the page is framed **and** the deployment allows framing (`PUBKY_RUNTIME_FRAME_ANCESTORS` is not empty), when `PUBKY_RUNTIME_EMBEDDED=true`, or when the URL has `?embedded=1` (read once per page load). A frame the deployment does not allow keeps the normal layout: that is how the Cypress and Vitest browser harnesses, which run the page in an iframe, stay unchanged. Embedded, the Shop renders no header, no mobile header, no mobile footer and no floating action button: the host app owns the page chrome. It renders one legal strip at the bottom of every page instead (`EmbeddedLegalFooter`): the contracting entity (Synonym Software, S.A. de C.V.), the Terms of Service dialog, the complaint address and a pointer to Report listing, which stays on the listing page. The marketplace section bar (Marketplace, Messages, Watchlist, Cart, Offers, Orders, Activity, My shop) is page content and stays, so every Shop destination remains reachable.

The document also gets `data-shop-embedded="true"`, which collapses the header offsets (`--header-offset-main`, `--header-offset-mobile`, the marketplace sub-navigation's fixed mobile offset) so sticky elements stick to the top of the frame instead of leaving a gap where the Shop header used to be.

A deployment that sets `PUBKY_RUNTIME_EMBEDDED=true` renders this from the first byte. A page detected only in the browser (framed, or `?embedded=1`) shows the Shop chrome for a moment, then drops it right after hydration.

## Service worker

The Serwist build plugin no longer registers the worker by itself. `ServiceWorkerRegistration` registers it only when the Shop is **not** embedded and **not** mounted under a base path. Shop therefore registers no worker under `/shop-embed`; App owns the origin's worker. That build also disables Serwist's automatic reload on reconnect, which otherwise runs even with registration disabled and discards checkout or seller form state. App owns outage recovery; standalone builds retain their existing reconnect behavior. App's updated worker handles document navigations beneath `/shop-embed` as network-only, including navigation-preload responses, and excludes those navigations from its offline fallback. This does not add a worker cache rule for Shop APIs or assets. `/shop` remains an App shell route. Activate the updated App worker before testing the mount.

## Browser storage

App and Shop use separate application storage namespaces on a shared origin. Reusing a Dexie name can expose either app's database to the other's schema upgrade/reset policy, while shared localStorage names can mix account state and cleanup.

Names the App also defines now carry a `shop-` prefix:

| Before | After |
|---|---|
| Dexie `franky` | `shop-franky` |
| Messaging keyring `franky-messaging-keyring` (retired with the old messaging transport; the Shop deletes it, see below) | `shop-franky-messaging-keyring` |
| `auth-store`, `onboarding-storage`, `notification-store`, `search-store`, `home-store`, `hot-store`, `settings-storage`, `marketplace-display-storage` | the same names with `shop-` |
| `pubky-feature-discovery:*` | `shop-pubky-feature-discovery:*` |
| session keys `pubky:force-feed-scroll-top`, `pubky-app:mute-sync-cursor:*` | `shop-` prefixed (not migrated; per-tab) |

Names only the Shop uses (`marketplace:*`, `pubky.marketplace.*`, the Web Lock names) are unchanged, because nothing else can collide with them.

### Migration of existing users

Runs on the first load of the new build, in two parts:

- **localStorage, synchronous.** Runs while the persisted stores are imported, before any store reads its key. Each legacy key is copied to its namespaced name, read back, then deleted.
- **IndexedDB, before the database opens.** Under one exclusive Web Lock: every table of `franky` is copied, then each table's row count is checked, and only then are the legacy databases deleted. The retired messaging keyring that sat next to the legacy database (`franky-messaging-keyring`) is deleted, not carried over; the chat that replaced that transport keeps no key material in a separate database ([`../chat/README.md`](../chat/README.md)).

Guarantees:

- **Copy before deletion.** The namespace copy verifies destination values/row counts before removing the corresponding legacy data. A partial localStorage failure keeps uncopied entries for retry. Database initialization can still apply the release's schema reset policy before copying; namespace migration is not a backup. A failed database migration shows the existing recovery screen instead of opening an empty database.
- **Safe to run twice.** Copies are add-if-absent: an existing namespaced row or key always wins over the legacy one. A recorded outcome (`shop-storage-migration:local-v1`, `shop-storage-migration:database-v1` in localStorage) ends every later run at once, so a stale tab on the old build, or an App that later writes `auth-store` or `franky` on the same origin, is never read.
- **Legacy ownership.** The legacy database must contain Shop-only tables (`commerce_shops`); a database that does not is left alone and recorded as foreign. With legacy adoption disabled (the default under a base path, and always while embedded), legacy data is not read or moved. The decision is recorded so flipping the setting later cannot start adopting App data.
- **Quota.** The copy briefly holds the data twice. A device too full to copy keeps the legacy data and retries.

Known edges:

- A tab still running the previous build writes to the legacy names after the move; those writes are not carried over. Close old tabs after deploying.
- The marketplace promo's pre-paint script (inline, before any bundle) reads the new key, so on the very first load after the upgrade a user who had dismissed the promo may see it for a moment.
- If the migration cannot delete a legacy database because another tab holds it open, it leaves the database and moves on (after five seconds).

### Never delete outside the namespace

On iOS Safari (verified on 26.1 and 26.2), `indexedDB.deleteDatabase` called from inside the frame wipes the top page's record of that database too. Whatever the embedded Shop deletes or clears is therefore gone for the host app as well, so the Shop deletes and clears only names inside its namespace:

- Sign-out and identity-switch wipes clear tables of `shop-franky` and remove only `shop-` keys; the retired `shop-franky-messaging-keyring` database is deleted once at boot (`DatabaseProvider`), never a host app's database. A version change recreates `shop-franky`, never `franky`.
- The one-time migration is the only code that deletes an un-namespaced database or key, and only the Shop's own legacy data: it never runs while the Shop is embedded, never on an origin where the legacy names are the host app's, and never on a `franky` that lacks the Shop-only tables.
- `src/core/database/franky/franky.namespace-isolation.test.ts` seeds a host app's `franky`, `franky-messaging-keyring`, `pubky-auth` and localStorage keys, runs the migration, sign-out wipes and a schema-change recreate, and fails if any deleted database or removed key is outside the namespace or any host data changed.

The SDK's `pubky-auth` store is intentionally shared. Shop no longer clears it wholesale: standalone cleanup removes exact Shop-owned records and pending flow keys. An embedded Shop never removes the App-owned record. The SDK 0.16 pending-key compatibility adapter and its upgrade constraints are described in [Grant authentication and App-owned sessions](grant-auth-session.md#ownership-and-cleanup).

### Standalone origins

A standalone Shop can run and migrate its own legacy storage independently. The embedded deployment disables legacy adoption to protect App storage. Existing `shop.pubky.app` data stays on that origin; enabling the App integration does not move it.

## Mounted-path details

Prefixed with the mount path: same-origin API calls (including marketplace grant/bootstrap clients and development signup-token requests), Passport popup callbacks, public images (through `BasePathImage`), `<video>` and CSS-referenced artwork, `history.replaceState` for the checkout URL, and the OG fallback redirect. Prefixed with the public path (the mount path unless `PUBKY_RUNTIME_SHOP_PUBLIC_PATH` is set): share links, canonical and Open Graph URLs (`metadataBase` stays the origin; root-relative values are prefixed) and structured data. Next.js handles the router, `next/link`, redirects and `/_next` assets itself. The web manifest link is omitted under a base path.

## Remaining deployment and release work

The outer/inner route scheme, App-owned sign-in, targeted SDK cleanup and mounted BFF/Passport paths are implemented. The work still requiring deployment or live verification is:

- Deploy both compatible frontends, the prefix-preserving proxy and updated App worker together. Require the mounted BFF readiness check to pass before sending users to the new deployment.
- Verify desktop/mobile Shop navigation and direct `/shop` links load the embedded Shop without an enable flag. Simulate a BFF outage, restore it, and verify the unavailable state recovers automatically at the same Shop URL.
- Enable/configure marketplace grant bootstrap, origin allow-lists, assertion issuer/key trust and service callback origins. Grant-only homeserver login does not remove Shop BFF cookies or replace marketplace/Locks service approval. An unavailable grant backend must remain an explicit unavailable state.
- Exercise real Ring, Bitkit, Passport, recovery-file and signup journeys, migrated cookie users, narrow grants, rejected approvals, account switches, two tabs, revoked records and sign-out while approval is pending.
- Verify Safari/mobile IndexedDB persistence across restart, Web Locks, cross-tab lifecycle, synchronous signer/popup gestures, and nested Paykit/Locks frames with the deployed origin.
- Verify deep links, refresh, Back/Forward, search/hash preservation, top-level signer/PayPal returns, and updated visual baselines.
- Coordinate Matthew's separate Inbox/chat migration with the same account lifecycle and existing history. No `e` scope or new messaging protocol is introduced by this embedding work.

The SDK 0.16.1 local production pair passed restoration of genuine SDK 0.16.0 records, reload, two tabs, and App logout with both Shop iframes absent in Chromium and WebKit on 2026-10-13, without session revival. Chromium also passed temporary-renewal recovery and BFF HTTP 503 cleanup followed by explicit HTTP 204 retry. Synthetic cross-origin popups from App and framed Shop returned through the actual mounted Passport callback in both browsers, preserving the opener and mounted fallback. These checks used real SDK/WASM and IndexedDB with intercepted network fixtures; they do not establish deployed Passport behavior, real backend availability, mobile signer gestures or payment completion.

The full migration contract and known recovery-file-only commerce limitation are in [Grant authentication and App-owned sessions](grant-auth-session.md). Automated source tests do not establish live payment or signer completion.

`PUBKY_RUNTIME_EMBEDDED=true` is valid only in a build with `NEXT_PUBLIC_BASE_PATH=/shop-embed`. Runtime validation rejects any other mount at startup and in injected client configuration. Rebuild the artifact when changing this build-time path.
