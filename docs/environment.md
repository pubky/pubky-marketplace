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

`NEXT_PUBLIC_DB_VERSION` is `9` (the default in `env.ts`, `.env.example` and the Docker workflows; Vercel staging and production need the same value). Dexie version 9 declares the chat tables (`chat_identity`, `chat_conversations`, `chat_messages`, `chat_sync_state`) and drops the retired `commerce_messaging_*` tables; with an older declared version the chat tables do not exist and `db.table('chat_identity')` throws at import time (an SSR 500). See [`chat/README.md`](chat/README.md).

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
- **Optional/defaulted public values**: operational polling and TTL settings, moderated tags, exchange-rate API, Prelude, Plausible, metadata/branding defaults, external links, and the USDT payments switch (`PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED`, default `false`; see [USDT payments](ecommerce/usdt-payments.md)). The Paykit Server API switch (`PUBKY_RUNTIME_PAYKIT_SERVER_API`, `fork` by default or `upstream`) mirrors the marketplace service's `PAYKIT_SERVER_API`: `upstream` targets pubky/paykit-server and pubky/locks, takes buyers only through a Paykit App Registry, reads seller readiness from the Lock Server, and fails the config parse unless `PUBKY_RUNTIME_PAYKIT_SETUP_CREATOR_PARAM=false`. Missing values use the defaults in `src/libs/runtime-config/runtime-config.schema.ts`; malformed provided values still fail loudly.

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

| Variable                                            | Default                       | Meaning                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE`               | `unavailable`                 | `unavailable`, `sandbox`, `transaction-service` or `locks-paykit`. `locks-paykit` is real payments and refuses to start unless `MARKETPLACE_URL`, `LOCKS_URL` and `PAYKIT_SETUP_URL` are all set explicitly.                                                                                                             |
| `PUBKY_RUNTIME_MARKETPLACE_URL`                     | `http://localhost:3100`       | Marketplace transaction service.                                                                                                                                                                                                                                                                                         |
| `PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL`               | unset                         | Marketplace indexing Nexus (`pubky/marketplace-nexus`). Only commerce reads use it; social surfaces keep `PUBKY_RUNTIME_NEXUS_URL`. Unset means marketplace reads use `PUBKY_RUNTIME_NEXUS_URL` too.                                                                                                                     |
| `PUBKY_RUNTIME_LOCKS_URL`                           | `http://localhost:3101`       | Lock Server.                                                                                                                                                                                                                                                                                                             |
| `PUBKY_RUNTIME_PAYKIT_SETUP_URL`                    | `http://localhost:3102/setup` | Paykit `/setup` iframe URL (seller payment setup).                                                                                                                                                                                                                                                                       |
| `PUBKY_RUNTIME_PAYKIT_SERVER_API`                   | `fork`                        | `fork` talks to the `BitcoinErrorLog/paykit-server` fork API. `upstream` talks to `pubky/paykit-server` (rc11) with `pubky/locks` (rc10). Mirrors the service's `PAYKIT_SERVER_API`; switch both together with the setup URL.                                                                                            |
| `PUBKY_RUNTIME_PAYKIT_SETUP_CREATOR_PARAM`          | `true`                        | Whether the setup URL carries `creator`. The fork needs it. Upstream rejects it, so `PAYKIT_SERVER_API=upstream` fails startup unless this is `false`.                                                                                                                                                                   |
| `PUBKY_RUNTIME_COMMERCE_POLL_INTERVAL_MS`           | `2000`                        | Order and payment status polling.                                                                                                                                                                                                                                                                                        |
| `PUBKY_RUNTIME_AUCTION_DURATIONS_MINUTES`           | `[10080]`                     | Auction lengths the listing studio offers, as a JSON array of minutes; the first is preselected. Staging can add short ones (for example `[15,60,10080]`) so a test run reaches the auction close and the winner's 30-minute payment window. A deploy with `PUBKY_RUNTIME_ENV=production` refuses lengths under one day. |
| `PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED`               | `false`                       | Dark flag. The Shop may offer USDT only when this is on and the service `/health` reports `usdt_payments.available`. See [`ecommerce/usdt-payments.md`](ecommerce/usdt-payments.md).                                                                                                                                     |
| `PUBKY_RUNTIME_MARKETPLACE_GRANT_FLOW_ENABLED`      | `false`                       | Client side of the grant-based approval flow (`pubkyauth://signin_grant`, [`ecommerce/step-up-approval.md`](ecommerce/step-up-approval.md)). The server side is `SHOP_BFF_GRANT_FLOW_ENABLED` ([`operations/RESUME-grant-bff.md`](operations/RESUME-grant-bff.md)).                                                      |
| `PUBKY_RUNTIME_MARKETPLACE_GRANT_POLL_MILLISECONDS` | `1000`                        | Grant approval polling, 750 to 5000.                                                                                                                                                                                                                                                                                     |
| `PUBKY_RUNTIME_PASSPORT_SIGN_IN`                    | `true`                        | Offer Pubky Passport ("Continue with Google"). `false` hides every entry point without a rebuild.                                                                                                                                                                                                                        |
| `PUBKY_RUNTIME_PASSPORT_URL`                        | unset                         | Passport origin override. Unset uses the Passport deployment for this deploy's homeserver.                                                                                                                                                                                                                               |
| `PUBKY_RUNTIME_INBOX_URL`                           | unset                         | Base URL of the `pubky/inbox` ping service that chat uses for wake-ups and stranger first contact ([`chat/README.md`](chat/README.md)). Unset or empty disables the inbox; chat then runs on homeserver event streams and reconciliation alone. Grant sessions only: cookie sessions cannot open an inbox session.       |
| `PUBKY_RUNTIME_INBOX_AUDIENCE`                      | the inbox URL                 | Audience string the inbox expects in session proofs (`INBOX_AUTH__AUDIENCE` on the service).                                                                                                                                                                                                                             |
| `PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS`                | `false`                       | Every grant sign-in also asks the signer for `e` on `/priv/pubky.app/marketplace/` (scoped encryption keys). Needs the homeserver listed below. See [`ecommerce/priv-key-wrapping.md`](ecommerce/priv-key-wrapping.md).                                                                                                  |
| `PUBKY_RUNTIME_PASSPORT_PRIV_ENCRYPTION_KEYS`       | `false`                       | The same request for the Pubky Passport sign-in and Passport step-up only (Passport 1.2.0+ answers `e` with selective approval). Needs the homeserver listed below.                                                                                                                                                      |
| `PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS`    | `[]`                          | JSON array of homeserver public keys known to run scoped encryption keys. `e` is requested only while `PUBKY_RUNTIME_HOMESERVER` is listed.                                                                                                                                                                              |

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
