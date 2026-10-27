# Environment Variables

Configuration is split into two surfaces with different lifetimes:

- **Build-time (`src/libs/env/env.ts`)**: build-intrinsic public values and server-only variables, validated with Zod at module load.
- **Runtime (`src/libs/runtime-config/`)**: everything environment-specific or deployer-facing, read from `PUBKY_RUNTIME_*` env vars on the server and inlined into the HTML. Outside Vercel every route renders per request, so a single Docker image works everywhere; on Vercel, pages are prerendered at build time with the build's env, so a change takes effect only on the next deployment (see [How it works](#how-it-works)).

## Build-time environment (`Env`)

All build-time variables are validated in `src/libs/env/env.ts` using Zod schemas. This provides:

- **Type safety**: All env vars are properly typed
- **Validation**: Invalid values cause startup errors
- **Defaults**: Sensible defaults where applicable
- **Documentation**: Clear indication of what each variable does

The schema is intentionally small:

- **Build-intrinsic public values** (baked into the artifact by design): `NEXT_PUBLIC_DB_NAME`, `NEXT_PUBLIC_DB_VERSION`, `NEXT_PUBLIC_DEBUG_MODE`, `NEXT_PUBLIC_APP_VERSION`, and the optional social link-out origin `NEXT_PUBLIC_SOCIAL_HOST`.
- **Server-only variables** (never exposed to the browser): `HOMESERVER_ADMIN_URL` / `HOMESERVER_ADMIN_PASSWORD` (dev/test signup tokens) and the Chatwoot support credentials (`BASE_URL_SUPPORT`, `SUPPORT_API_ACCESS_TOKEN`, `SUPPORT_ACCOUNT_ID`).
- **Build commit** (optional, read straight from the process environment, not part of the schema): `GIT_COMMIT` (Docker build arg, or `--env` on a CLI deploy) or Vercel's `VERCEL_GIT_COMMIT_SHA`. `GET /api/build` returns the short SHA as `{"commit": "..."}`, or `unknown`, and nothing else. At build time the same variables (`--build-env` on a CLI deploy) give the full SHA that becomes `NEXT_PUBLIC_APP_VERSION`, the Sentry release, when `NEXT_PUBLIC_APP_VERSION` itself is unset (see [Sentry → Releases](sentry.md#releases)).
- `NODE_ENV` / `VITEST`.

### Removed vibe session consumer

The cookie-based vibe consumer and `#s=` handoff are removed. Keep `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` unset; the retired settings are ignored and no longer enable sign-in or session restoration. Old cookie identities retain local history and must sign in again for a grant. [ADR 0029](adr/0029-vibe-session-consumer.md) records the historical design. The supported shared sign-in uses App `/shop` around Shop `/shop-embed` on one origin; follow [Shop embedding](launch/shop-embedding.md) for its build and runtime configuration.

### Social link-out (optional)

`NEXT_PUBLIC_SOCIAL_HOST` hands the Shop's social surfaces to the canonical social app. It is baked into the artifact, so changing it needs a rebuild.

| Variable                  | Required | Meaning                                                                                                                                                                                                                 |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SOCIAL_HOST` | No       | Exact `https://` origin of the social app (`https://pubky.app`, or `https://staging.pubky.app` for staging). `http://localhost:<port>` is allowed only when `NODE_ENV !== 'production'`. Invalid values fail the build. |

When unset (the default) nothing changes. When set:

- `/home`, `/feed/*`, `/hot`, `/search`, `/who-to-follow`, `/post/*`, `/collections/*`, `/profile/*` and `/settings/*` 307-redirect to the same path and query on the social host (`src/libs/social-host/social-host.ts`, applied in `next.config.ts`). `/profile/notifications` goes to `/marketplace/notifications` instead.
- The header and mobile footer show Marketplace, Messages and one Pubky link; the social search box is hidden; the account menu points at `/marketplace/notifications` and `/marketplace/settings`, which gains a sign-out card.
- Every in-app "go home" (route guard, logo, end of onboarding, not-found fallbacks) goes to `/marketplace`, so a signed-in user is never sent to the social host, where the Shop session does not carry over.
- Seller and reviewer names in the marketplace and messages link to the person's shop, with a small "Profile on Pubky" link beside them.

The redirects are unconditional and carry no session. Until single sign-on exists, each site keeps its own sign-in: a user signed in to the Shop (Ring, Bitkit or any other session) arrives on the social host signed out unless they already signed in there, and signs in there separately. This is the accepted beta behaviour, and no Shop copy promises otherwise; keep the "Pubky" and "Profile on Pubky" link labels free of any claim that the user will be signed in.

The build also fails when the value is one of the Shop's own origins (a leading `www.` on either side is ignored), because every social route would redirect to itself. Those origins are `PUBKY_RUNTIME_DEFAULT_URL` (only when set explicitly) and, on Vercel, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL` and `VERCEL_URL`.

### Serving under a base path (optional)

`NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_ASSET_PREFIX` let the Shop run under a sub-path of another origin, for example `https://pubky.app/shop-embed` behind a reverse proxy. Both are baked into the build by Next.js (routes manifest, client bundles), so a change needs a rebuild; in Docker, pass them as build args.

| Variable                   | Required | Meaning                                                                                                                                                                    |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_BASE_PATH`    | No       | Mount path, `/shop-embed` for the App integration. Leading slash, no trailing slash, unreserved characters only. Unset or empty serves from the origin root (the default). |
| `NEXT_PUBLIC_ASSET_PREFIX` | No       | Prefix for `/_next/*` assets: a path (`/shop-static`) or an absolute `http(s)` URL without a trailing slash. Unset keeps the Next.js default.                              |

Components must not hard-code root-relative URLs for things the Next.js router does not rewrite. Use `withBasePath('/api/...')` from `@/config/base-path` for `fetch`, `<video>`, CSS `url()` and `history.replaceState`; `next/image` goes through `BasePathImage` (`@/atoms/BasePathImage/BasePathImage`), and `next/link`, `router.push` and redirects need nothing. See [docs/launch/shop-embedding.md](launch/shop-embedding.md) for the proxy, framing, storage and navigation contract.

`PUBKY_RUNTIME_SHOP_PUBLIC_PATH` (unset by default) is the path people use to reach the Shop when it differs from the build's mount path. On pubky.app the App owns `/shop` and frames the build mounted at `/shop-embed` (`NEXT_PUBLIC_BASE_PATH=/shop-embed`), so the Shop sets `PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop`. Use `withBasePath` for what the iframe itself requests (assets, API calls, the Passport popup return) and `withPublicPath` for a URL that leaves the page and comes back top-level (share links, canonical and Open Graph URLs). Unset means the mount path, so a standalone Shop and a Shop served directly under `/shop` are unchanged.

### Browser storage namespace

`NEXT_PUBLIC_DB_NAME` defaults to `shop-franky` (it was `franky`). Persisted store keys, the feature-discovery flags and a few session keys carry a `shop-` prefix (`shopStorageKey` in `@/libs/storage-namespace/storage-namespace`), so the Shop and pubky.app can share an origin. A one-time, idempotent migration moves an existing user's data into the namespace; `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY` says whether this origin's old names belong to the Shop (default: yes unless `NEXT_PUBLIC_BASE_PATH` is set). New persisted keys must be added to `src/core/stores/persistedKeys.ts` so they are namespaced and migrated.

`NEXT_PUBLIC_DB_VERSION` is `9` (the default in `env.ts`, `.env.example` and the Docker workflows; every deployment needs the same value). Dexie version 9 declares the chat tables (`chat_identity`, `chat_conversations`, `chat_messages`, `chat_sync_state`) and drops the retired `commerce_messaging_*` tables; with an older declared version the chat tables do not exist and `db.table('chat_identity')` throws at import time (an SSR 500). See [`chat/README.md`](chat/README.md).

### Framing and embedded mode (runtime)

`PUBKY_RUNTIME_FRAME_ANCESTORS` lists the origins allowed to frame the Shop (exact origins and `'self'`, space- or comma-separated). Unset keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`. The headers are set per request by `src/proxy.ts`, so the value is read at run time, not build time. `PUBKY_RUNTIME_EMBEDDED=true` forces the embedded layout and behaviour (no Shop header or footer, top-window navigation, no service worker) without frame detection; a framed page (when `PUBKY_RUNTIME_FRAME_ANCESTORS` is set) and `?embedded=1` are detected without it.

### Adding or Modifying Variables

First decide which surface the value belongs to:

- **Environment-specific or deployer-facing (public)** → it is runtime config. Add it to `src/libs/runtime-config/runtime-config.schema.ts` (schema + default + `PUBKY_RUNTIME_*` name) and expose a lazy getter from `src/libs/runtime-config/runtime-config.ts`. Do NOT add a `NEXT_PUBLIC_*` name for it.
- **Build-intrinsic or server-only** → it belongs in `env.ts`. You MUST update **two places**:

#### 1. Add to `envSchema`

```typescript
const envSchema = z.object({
  // ... existing variables ...
  MY_SERVER_ONLY_VAR: z.string().min(1).optional(),
});
```

#### 2. Add to `parseEnv()`

```typescript
function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse({
    // ... existing variables ...
    MY_SERVER_ONLY_VAR: process.env.MY_SERVER_ONLY_VAR,
  });
}
```

#### Checklist

- [ ] Added to `envSchema` with Zod validation
- [ ] Added to `parseEnv()` safeParse object
- [ ] Added to `.env.example` with documentation
- [ ] Added to `.env` (local development)
- [ ] Added tests if the variable has special parsing logic

### Usage

Import the validated environment instead of using `process.env` directly:

```typescript
import { Env } from '@/libs/env/env';

const dbVersion = Env.NEXT_PUBLIC_DB_VERSION; // number
const debugMode = Env.NEXT_PUBLIC_DEBUG_MODE; // boolean
```

## Runtime configuration (`PUBKY_RUNTIME_*`)

All **environment-specific and deployer-facing public values** are configured through the server's environment rather than inlined into the client bundle, so a single Docker image can be promoted across staging / prod / testnet — and deployed by third parties against their own infrastructure — without rebuilding. See [ADR 0017](adr/0017-runtime-config-injection.md) and [ADR 0018](adr/0018-runtime-sentry-and-decoupled-source-maps.md).

The contract has three tiers:

- **Required (9 network values)**: `nexusUrl`, `cdnUrl`, `homeserver`, `homeserverUrl`, `homegateUrl`, `defaultHttpRelay`, `pkarrRelays`, `testnet`, `deployEnv`. (`deployEnv` — `PUBKY_RUNTIME_ENV`, `"production"` or `"staging"` — is the deploy's declared identity; it drives the staging homeserver sign-in guard (`isStagingHomeserverDeploy` in `@/config/network`), which is declared explicitly instead of inferred from network values so config drift can never silently disable it.) (`homeserverUrl` is the homeserver's HTTP base URL, used for invite-code verification — the homeserver pubkey has no resolvable HTTPS endpoint, see [pubky-core#410](https://github.com/pubky/pubky-core/issues/410).)
- **Optional (5 Sentry values)**: `sentryDsn` (absent/empty disables Sentry entirely), `sentryEnvironment` (absent falls back to `NODE_ENV`), `sentryTracesSampleRate` / `sentryReplaysSessionSampleRate` / `sentryReplaysOnErrorSampleRate` (defaults `0.1` / `0.0` / `1.0`). A malformed value (bad DSN URL, rate outside `[0,1]`) fails loudly.
- **Optional moderation identity**: `moderationId` must be a raw 52-character z-base-32 Pubky when set. In deployed environments, leaving it unset disables moderation-tag matching and the one-time default follow.
- **Optional/defaulted public values**: operational polling and TTL settings, moderated tags, exchange-rate API, Prelude, Plausible, metadata/branding defaults, external links, and the USDT payments switch (`PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED`, default `false`; see [USDT payments](ecommerce/usdt-payments.md)). The Paykit Server API switch (`PUBKY_RUNTIME_PAYKIT_SERVER_API`, `fork` by default or `upstream`) mirrors the marketplace service's `PAYKIT_SERVER_API`: `upstream` targets pubky/paykit-server and pubky/locks, takes buyers only through a Paykit App Registry, reads seller readiness from the Lock Server, and fails the config parse unless `PUBKY_RUNTIME_PAYKIT_SETUP_CREATOR_PARAM=false`. A `PUBKY_RUNTIME_ENV=staging` deploy must also set `PUBKY_RUNTIME_EXCHANGE_RATE_API` explicitly (the default is production Blocktank) and must not use the production relay `httprelay.pubky.app`. Missing values use the defaults in `src/libs/runtime-config/runtime-config.schema.ts`; malformed provided values still fail loudly.

### Why a separate mechanism

Next.js inlines every literal `process.env.NEXT_PUBLIC_*` reference at **build time** (even in server code). A value baked into the image cannot change per environment. To make these values runtime-configurable we read **non-`NEXT_PUBLIC_` env names** (`PUBKY_RUNTIME_*`) on the server when the HTML is rendered and inject them into it. Rendering happens per request outside Vercel and at build time on Vercel (below).

### How it works

- The server reads `PUBKY_RUNTIME_*` at boot (fail-fast in `src/instrumentation.ts`) and when it renders HTML, validates them, and memoizes the result (`src/libs/runtime-config/runtime-config.ts`).
- When HTML is rendered depends on the platform (`renderPerRequestOutsideVercel` in `src/libs/runtime-config/render-mode.ts`, called from the root layout). **On Vercel** (`VERCEL=1`) pages are prerendered at build time, so the config inlined into them is the build's env: an env change on Vercel takes effect only with a new deployment, and promoting an older deployment brings back that deployment's config. **Everywhere else** (Docker images, the CI artifact `launch-e2e` starts, local builds and `npm run dev`) every route renders per request with the running server's env.
- The validated config is serialized into a **raw inline `<script>`** (`window.__PUBKY_CONFIG__`) rendered first in `<body>` by `ContainerRoot`, so it executes during HTML parsing — before any app bundle (including `instrumentation-client.ts`) evaluates. It must stay a raw `<script>` element: App Router's `next/script` defers inline `beforeInteractive` content until after the main bundle's module scope runs.
- App code reads values through lazy getters from `@/libs/runtime-config/runtime-config`, usually re-exported through concrete config modules such as `@/config/nexus`, `@/config/network`, `@/config/sync`, `@/config/moderation`, `@/config/metadata`, and `@/config/externalLinks`.
- Schema, tiers, and defaults live in `src/libs/runtime-config/runtime-config.schema.ts`.

```typescript
import { getNexusUrl } from '@/config/nexus';
import { getHomeserver, getTestnet } from '@/config/network';

const url = getNexusUrl(); // resolved at call time
```

> Do NOT read `process.env.PUBKY_RUNTIME_*` directly, and do NOT invent new `NEXT_PUBLIC_*` names for runtime-configurable values — ESLint rules block both. Use the getters.

### Strict (deployed) vs lenient (dev/test)

- **Deployed (`NODE_ENV=production`, including staging), or `PUBKY_RUNTIME_CONFIG_REQUIRED=true`**: the nine required network `PUBKY_RUNTIME_*` values must ALL be set. Missing/invalid config throws **at boot** (no silent fallback to staging defaults).
- **Local dev / tests**: the SAME `PUBKY_RUNTIME_*` names are read leniently — unset values resolve to the staging defaults in `runtime-config.schema.ts` (including `deployEnv: staging`, so the staging sign-in guard is active in plain local dev; set `PUBKY_RUNTIME_ENV=production` in `.env.local` to turn it off), including the staging moderation identity. Partial overrides (e.g. only `PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080` in `.env.local`) layer over those defaults.
- **Optional/defaulted tiers**: `PUBKY_RUNTIME_SENTRY_*` and the other deployer-facing public values can be set independently in any mode; malformed provided values fail loudly.

`PUBKY_RUNTIME_MODERATION_ID` is intentionally different from the other app defaults in deployed mode: unset resolves to `undefined`, while a configured value must be a valid Pubky. This prevents a missing production setting from silently targeting the staging moderation account. Deployed startup emits a warning when it is unset so operators can distinguish an intentional disabled state from missing configuration.

> Running a production build locally (`npm run build && npm run start`) runs as `NODE_ENV=production`, so it **requires** all nine network `PUBKY_RUNTIME_*` values. `npm run dev` does not — unset values use staging defaults. See the `PUBKY_RUNTIME_*` block in `.env.example`.

### These are PUBLIC values

`PUBKY_RUNTIME_*` are public (URLs, the homeserver public key, relay lists, the Sentry DSN) — they are exposed to the browser by design. They are **not secrets**; deployment tooling should not treat them as sensitive.

### Running the public image (`docker run`)

Copy-paste starting point for any deployer — nine required values plus the optional Sentry tier:

```bash
docker run -p 3000:3000 \
  -e PUBKY_RUNTIME_NEXUS_URL=https://nexus.example.com \
  -e PUBKY_RUNTIME_CDN_URL=https://nexus.example.com/static \
  -e PUBKY_RUNTIME_HOMESERVER=<homeserver-pubkey> \
  -e PUBKY_RUNTIME_HOMESERVER_URL=https://homeserver.example.com \
  -e PUBKY_RUNTIME_HOMEGATE_URL=https://homegate.example.com \
  -e PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=https://httprelay.example.com/inbox \
  -e PUBKY_RUNTIME_PKARR_RELAYS='["https://pkarr.example.com"]' \
  -e PUBKY_RUNTIME_TESTNET=false \
  -e PUBKY_RUNTIME_ENV=production \
  -e PUBKY_RUNTIME_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project> \
  -e PUBKY_RUNTIME_SENTRY_ENVIRONMENT=production \
  pubky-app
```

Omit the `PUBKY_RUNTIME_SENTRY_*` lines to run without Sentry. Other public runtime values are optional/defaulted; set them only when you need to tune polling/TTL behavior, branding/metadata, analytics, moderation, Prelude, exchange rates, or external links. Note for Sentry users: the image ships without browser source maps (Debug IDs only) — see the source-maps section of [docs/sentry.md](sentry.md).

### Marketplace and payments (runtime)

With none of these keys set the Shop runs with `PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=unavailable` and offers no checkout. All of them are `PUBKY_RUNTIME_*` keys validated by `runtime-config.schema.ts`. How to run each mode locally is in [`ecommerce/RUNNING.md`](ecommerce/RUNNING.md).

| Variable                                            | Default                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE`               | `unavailable`                 | `unavailable`, `sandbox`, `transaction-service` or `locks-paykit`. `locks-paykit` is real payments and refuses to start unless `MARKETPLACE_URL`, `LOCKS_URL` and `PAYKIT_SETUP_URL` are all set explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PUBKY_RUNTIME_MARKETPLACE_URL`                     | `http://localhost:3100`       | Marketplace transaction service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL`               | unset                         | Marketplace indexing Nexus (`pubky/marketplace-nexus`). Only commerce reads use it; social surfaces keep `PUBKY_RUNTIME_NEXUS_URL`. Unset means marketplace reads use `PUBKY_RUNTIME_NEXUS_URL` too.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUBKY_RUNTIME_LOCKS_URL`                           | `http://localhost:3101`       | Lock Server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PUBKY_RUNTIME_PAYKIT_SETUP_URL`                    | `http://localhost:3102/setup` | Paykit `/setup` iframe URL (seller payment setup).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PUBKY_RUNTIME_PAYKIT_SERVER_API`                   | `fork`                        | `fork` talks to the `BitcoinErrorLog/paykit-server` fork API. `upstream` talks to `pubky/paykit-server` (rc11) with `pubky/locks` (rc10). Mirrors the service's `PAYKIT_SERVER_API`; switch both together with the setup URL.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PUBKY_RUNTIME_PAYKIT_SETUP_CREATOR_PARAM`          | `true`                        | Whether the setup URL carries `creator`. The fork needs it. Upstream rejects it, so `PAYKIT_SERVER_API=upstream` fails startup unless this is `false`. `false` with the fork (or with `PUBKY_RUNTIME_PAYKIT_SERVER_API` unset) also fails startup.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PUBKY_RUNTIME_COMMERCE_POLL_INTERVAL_MS`           | `2000`                        | Order and payment status polling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PUBKY_RUNTIME_AUCTION_DURATIONS_MINUTES`           | `[10080]`                     | Auction lengths the listing studio offers, as a JSON array of minutes; the first is preselected. Staging can add short ones (for example `[15,60,10080]`) so a test run reaches the auction close and the winner's 30-minute payment window. A deploy with `PUBKY_RUNTIME_ENV=production` refuses lengths under one day.                                                                                                                                                                                                                                                                                                                                    |
| `PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED`               | `false`                       | Dark flag. The Shop may offer USDT only when this is on and the service `/health` reports `usdt_payments.available`. See [`ecommerce/usdt-payments.md`](ecommerce/usdt-payments.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUBKY_RUNTIME_EU_FENCE_ENABLED`                    | `false`                       | EU scope fence (legal launch plan C2-C4), mirroring the service's `EU_FENCE_ENABLED`. On, the Shop asks buyers for their country where no address supplies it, sends it with each selling command, and shows business and undeclared sellers as unavailable to EU and UK buyers and sellers their yearly counters. Turn it on before the service flag (see [Turning the region flags on](#turning-the-region-flags-on)).                                                                                                                                                                                                                                    |
| `PUBKY_RUNTIME_DIGITAL_REGION_BLOCK_ENABLED`        | `false`                       | Digital items are not offered to buyers in the EU-27 or GB (legal launch plan C3b), mirroring the service's `DIGITAL_REGION_BLOCK_ENABLED`. Independent of the EU fence flag. **On for launch.** Turn it on before the service flag (see [Turning the region flags on](#turning-the-region-flags-on)).                                                                                                                                                                                                                                                                                                                                                      |
| `PUBKY_RUNTIME_REGION_MODES`                        | unset                         | Per-region commerce modes, mirroring the service's `REGION_MODES`: a comma-separated list of `SELECTOR=MODE`. Selectors are ISO 3166-1 alpha-2 codes, `EU` (the 27 member states) or `UNKNOWN` (a visitor whose country can't be determined). Modes are `open`, `nuanced` (the EU fence and digital hold, as before) and `blocked` (no buying, selling or paid unlocks). `none` opens everything. Unnamed countries are open; `UNKNOWN` defaults to the strictest mode in force. Unset, the two flags above decide (EU and GB nuanced); once set it wins and they are ignored. A malformed value fails the config parse. See [Region modes](#region-modes). |
| `PUBKY_RUNTIME_CLIENT_REGION_HEADER`                | `x-client-region`             | The request header the edge sets to the visitor's country, read by `/api/marketplace/client-region`. Mirrors the service's `CLIENT_COUNTRY_HEADER`. A lowercase header name; use `x-vercel-ip-country` on a Vercel deployment.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PUBKY_RUNTIME_MARKETPLACE_GRANT_FLOW_ENABLED`      | `false`                       | Client side of the grant-based approval flow (`pubkyauth://signin_grant`, [`ecommerce/step-up-approval.md`](ecommerce/step-up-approval.md)). The server side is `SHOP_BFF_GRANT_FLOW_ENABLED` ([`operations/RESUME-grant-bff.md`](operations/RESUME-grant-bff.md)).                                                                                                                                                                                                                                                                                                                                                                                         |
| `PUBKY_RUNTIME_MARKETPLACE_GRANT_SESSION_ENABLED`   | `false`                       | Mint the marketplace session from the sign-in grant (custom proof plus a homeserver proof document), so grant-backed users skip the "Enable selling" approval; the approval stays the fallback. Needs the service's `MARKETPLACE_GRANT_SESSION_ENABLED` with this Shop's grant client id listed. See [`ecommerce/step-up-approval.md`](ecommerce/step-up-approval.md#session-from-the-sign-in-grant).                                                                                                                                                                                                                                                       |
| `PUBKY_RUNTIME_MARKETPLACE_GRANT_POLL_MILLISECONDS` | `1000`                        | Grant approval polling, 750 to 5000.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUBKY_RUNTIME_PASSPORT_SIGN_IN`                    | `true`                        | Offer Pubky Passport ("Continue with Google"). `false` hides every entry point without a rebuild.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PUBKY_RUNTIME_PASSPORT_URL`                        | unset                         | Passport origin override. Unset uses the Passport deployment for this deploy's homeserver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PUBKY_RUNTIME_INBOX_URL`                           | unset                         | Base URL of the `pubky/inbox` ping service that chat uses for wake-ups and stranger first contact ([`chat/README.md`](chat/README.md)). Unset or empty disables the inbox; chat then runs on homeserver event streams and reconciliation alone. Grant sessions only: cookie sessions cannot open an inbox session.                                                                                                                                                                                                                                                                                                                                          |
| `PUBKY_RUNTIME_INBOX_AUDIENCE`                      | the inbox URL                 | Audience string the inbox expects in session proofs (`INBOX_AUTH__AUDIENCE` on the service).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS`                | `false`                       | Every grant sign-in also asks the signer for `e` on `/priv/pubky.app/marketplace/` (scoped encryption keys). Needs the homeserver listed below. See [`ecommerce/priv-key-wrapping.md`](ecommerce/priv-key-wrapping.md).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PUBKY_RUNTIME_PASSPORT_PRIV_ENCRYPTION_KEYS`       | `false`                       | The same request for the Pubky Passport sign-in and Passport step-up only (Passport 1.2.0+ answers `e` with selective approval). Needs the homeserver listed below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS`    | `[]`                          | JSON array of homeserver public keys known to run scoped encryption keys. `e` is requested only while `PUBKY_RUNTIME_HOMESERVER` is listed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS`       | `[]`                          | Review attestors this deployment trusts for "Verified purchase", added to the compiled defaults. JSON array of `{pubky, label, validFrom, validUntil?}`. See [Review attestor trust list](#review-attestor-trust-list).                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Review attestor trust list

A review shows **Verified purchase · _label_** only when its purchase attestation verifies and its issuer (`iss`) is on the trust list for the attestation's time. The list is `MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS` in `src/config/commerce.ts` plus `PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS`. The compiled defaults hold the keys every deployment trusts, which is only Pubky Market's production attestor, so the production deployment needs no runtime entry. Every other deployment lists its own transaction service's attestor key in the runtime variable. A staging attestor signs test purchases, so only the staging deployment lists it.

```json
[{ "pubky": "<attestor pubky>", "label": "Pubky Market", "validFrom": "2026-10-12" }]
```

- `pubky`: the attestor's z-base-32 public key, as the service logs it at boot ("attestation issuance enabled").
- `label`: the name on the badge, at most 40 characters.
- `validFrom`, `validUntil`: an RFC 3339 instant with an offset, or a `YYYY-MM-DD` date meaning 00:00 UTC. The window includes `validFrom` and excludes `validUntil`; leave `validUntil` out while the key is in use. When a key is rotated, keep the old entry and set its `validUntil` to the rotation time, so reviews it signed before then stay verified.
- A key may have several entries (several windows). A malformed value, an unknown field or a `validUntil` that is not later than `validFrom` fails the config parse, so a deployed server refuses to start.

**Which time is checked.** The attestation's time is its `iat` claim, the issuance instant: the purchase-attestation spec requires it, and the transaction service sets it when it signs. `completed_on` is the order's completion day, not the signing time, so it is not used. Where the Shop holds the attestation (the user's own review) it reads `iat`. The review index does not serve `iat`, so the public review lists use the record's `createdAt`, and they fail closed: the reviewer writes `createdAt`, so whoever holds a retired key could backdate a review into its window. In those lists an entry with a `validUntil` never vouches, and an entry without one vouches from its `validFrom` on. A rotated key's reviews therefore show "Attested (unrecognized attestor)" in public lists while still verified on the reviewer's own order. Once the index serves `iat` (design ticket IX2), the public lists check the window against `iat` and this fallback goes away. Seller and listing totals carry no per-review times, so they count an attestor only while its window is open now; a retired key's reviews then drop out of the totals but keep their badge on each review. `iat` is asserted by the key holder: a window stops a retired key's later use, not a thief who backdates, so remove a compromised key from the list.

On Vercel the config is fixed when the deployment is built (see [How it works](#how-it-works)): set the variable first, then deploy.

### Region modes

`PUBKY_RUNTIME_REGION_MODES` names the commerce mode of each region. Everything outside commerce (the social app, profiles, messages, settings, sign-in, browsing the Market, search, reviews on display) is never restricted by it.

| Mode      | What the Shop does                                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`    | Nothing. The Market renders as it always did.                                                                                                                                                                                                                                                 |
| `nuanced` | Today's behaviour: a buyer in the region buys only from sellers who declared themselves private (C3), sellers resident in the EU see their yearly counters (C4), and digital items are held back (C3b). The Shop asks for the buyer's country and sends it with each order.                   |
| `blocked` | Buy, Offer, Bid, Add to cart, Checkout and Pay are replaced by one line with an info icon. Sell, drops, store connections and Get paid show "Selling isn't available in your region yet." with a way back to the Market; the seller studio and the storefront settings stay open (see below). |

Examples:

- Launch: `PUBKY_RUNTIME_REGION_MODES=EU=blocked,GB=blocked,US=blocked`
- Counsel accepts the nuanced design for the EU and UK: `EU=nuanced,GB=nuanced,US=blocked`
- Counsel unlocks the US as well: `EU=nuanced,GB=nuanced`
- One country stricter than its group: `EU=nuanced,DE=blocked` (later entries override earlier ones)
- Emergency open: `none`

How the Shop decides, for each commerce surface on a Market page:

- **The visitor's IP country** comes from the Shop's own `GET /api/marketplace/client-region` route, which answers `{ "country": "DE" }` (or `null`) from the header `PUBKY_RUNTIME_CLIENT_REGION_HEADER`. `XX` and Tor markers count as unknown. The edge in front of the Shop must set and overwrite that header. The route is asked only from Market pages and only while a region is `blocked` (or `UNKNOWN` resolves to `blocked`); with nothing blocked the Shop makes no request and evaluates no rule outside nuanced regions.
- **The declared country** is the country a buyer gave on this device (or an order address they placed), and for a seller the country of their own shop.
- A visitor is blocked when the declared country **or** the IP country is blocked, or when the IP country is unknown and `UNKNOWN` is `blocked`. A declared country can only add a block. While the IP country is still being read the commerce buttons stay off without a message.
- A seller whose shop is in a blocked country can't sell, and buyers can't buy from them. The shop settings country field refuses a blocked country, and a new shop never gets a blocked default country: the default shop is not published until the seller picks one.
- **The shop country can be changed only from outside the block.** The storefront settings (`/marketplace/storefront`) stay open in a blocked region, with the selling line above the form. The country field is editable only while the seller's own IP region is open: a visitor inside the block, or one whose region can't be told where unknown visitors are blocked, sees it read-only with the reason under it, and a save that changes the country is refused the same way (the rest of the shop saves as before). While the region is still being read the field waits. A shop that has no country yet can still be given one from anywhere, since there is nothing to move. Saving a blocked country stays refused from anywhere. This guards the move, not selling: selling is held by the IP region and the shop country alike, so changing the country never unlocks it. The service reads the shop record from the homeserver on every command, so a new country counts at once. If the shop country was the reason, selling opens as soon as the seller's own region is open too; if the seller's region is still blocked, the line stays and says selling is paused until they are somewhere it is offered. The seller studio (`/marketplace/dashboard`) stays open read-only: Sell, Inventory, Payment settings, Store connections, Edit, Duplicate, Activate and Resume are off, and Orders, Storefront, Shipping presets, Pause and Export stay on. The Market page and a seller's own empty shop page offer no "Sell an item" where selling is held. The other selling pages show the selling line with a link to the shop country field when that is the reason.
- **A shop in a blocked country reads as buying, not selling, to a buyer.** The buyer sees "Buying from this shop isn't available yet."; the seller keeps "Selling isn't available from this country yet." on the shop settings and the payment settings.
- A buyer's saved country that is blocked keeps them blocked from any IP, so the blocked line names it with a Change action: change it, or clear it so only where they are counts.
- **A new delivery address starts with no browser-language guess where a region is blocked.** Its country is the visitor's IP country when that is not blocked, otherwise empty so the buyer chooses; with no region blocked it is the browser's country, as before. A tab that regains focus reads the IP country again, so switching networks needs no reload.
- **A shop or listing country must name a real country.** The field takes the two-letter code of an assigned country or territory and publishes its ISO code (`UK` is saved as `GB`); codes such as `ZZ`, `XX` or `EU` are refused. The inventory import applies the same rule to every row (a refused code fails that listing with the same message), and a default storefront takes the ISO code of the first listing that names a real country. A shop saved before this check with a code that names no country counts as having no country yet, so it can be given a real one from anywhere.
- The service decides in the end. Every refusal it sends with `COMMERCE_UNAVAILABLE_IN_REGION` or `SELLER_UNAVAILABLE_IN_REGION` (and the Lock Server's 451 on a paid unlock) shows the matching sentence.

Never blocked, so nobody is trapped with money in flight: existing orders and receipts, payment confirmation, refunds, returns, cancellations, shipping and delivery confirmation, reviews of an existing order, declining or withdrawing an offer, and taking a listing down.

### Turning the region flags on

The Shop settings (`PUBKY_RUNTIME_REGION_MODES`, or the older `PUBKY_RUNTIME_EU_FENCE_ENABLED` and `PUBKY_RUNTIME_DIGITAL_REGION_BLOCK_ENABLED`) and the service settings (`REGION_MODES`, or `EU_FENCE_ENABLED` and `DIGITAL_REGION_BLOCK_ENABLED`) are a pair, and the order matters: **tighten the Shop first, then the service. Loosen the service first, then the Shop.**

- The Shop sends `buyerCountry` with checkout, offer, bid and drop-claim commands only while a region is `nuanced` (with the older flags, while either is on), and leaves the field out when no country is known, never empty. Where regions are only `blocked`, the service decides from the IP country and the Shop asks for no country and remembers none; an order placed to an address still carries that address's country. The remembered country is stored with the pubky that gave it and removed at sign-out. A service setting that makes a region `nuanced` without it refuses those commands, because the service requires the country there.
- A Shop setting that is stricter than the service's is harmless: the service ignores the extra field and decides for itself.
- A Shop setting that is looser than the service's is not: the Shop would show Buy while the service refuses it, which is why loosening goes service first.
- With `PUBKY_RUNTIME_REGION_MODES` set, the two older flags are ignored. Unset it and they apply again.
- The blocked state reads the visitor's IP country from `PUBKY_RUNTIME_CLIENT_REGION_HEADER`. Set the header on the Shop backend before blocking a region, or every visitor reads as unknown and is blocked.

Framing, embedding and storage keys (`PUBKY_RUNTIME_FRAME_ANCESTORS`, `PUBKY_RUNTIME_EMBEDDED`, `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY`, `PUBKY_RUNTIME_SHOP_PUBLIC_PATH`, `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID`) are described in [Framing and embedded mode](#framing-and-embedded-mode-runtime) and [`launch/shop-embedding.md`](launch/shop-embedding.md).

### Homeserver mute list sync

Cross-session mute alignment uses the `@synonymdev/pubky` homeserver **event stream** (SSE). Debouncing uses a fixed delay in [`src/config/mute-sync.ts`](../src/config/mute-sync.ts) (`MUTE_SYNC_DEBOUNCE_MS`), not an environment variable.

### Chat

Buyer↔seller chat ([`chat/README.md`](chat/README.md)) runs on homeserver event streams, `pubky/inbox` pings and reconciliation. Its cadences and limits are constants in [`src/config/chat.ts`](../src/config/chat.ts), not environment variables; the deployer-facing keys are `PUBKY_RUNTIME_INBOX_URL` and `PUBKY_RUNTIME_INBOX_AUDIENCE` above, and the sign-in grant (`CAPABILITIES` in `src/config/app.ts`) must carry `/pub/chat/:rw` and `/priv/chat/:rw`.

## Setting Variables

1. **Development**: Create a `.env.local` file in the project root (both `Env` and `PUBKY_RUNTIME_*` values are honored)
2. **Production**: Set environment variables in your deployment platform
3. **Testing**: Variables are set in `src/config/test.ts`

## Validation Errors

If build-time environment validation fails, you'll see detailed error messages:

```
❌ Environment validation failed:
  - NEXT_PUBLIC_DB_VERSION: Expected number, received string
```

If deployed runtime config is missing or invalid, the server exits at boot with the full list of required `PUBKY_RUNTIME_*` network variables.

### Shared App/Shop navigation

With `NEXT_PUBLIC_SOCIAL_HOST` set, global Home, Hot, Collections, Settings, Profile and Search open their corresponding social App routes in the same tab. Search is a link; it does not query the Shop Nexus for social results. The Shop item and marketplace section navigation stay local. Product search remains in the marketplace catalog. Without this variable, the existing integrated navigation remains. The regular App needs its own Shop navigation link for the return trip.
