# Sentry (Observability)

How errors and performance data flow into Sentry from Pubky Marketplace (Shop).

The Shop already includes the Sentry Next.js SDK and browser, Node and Edge initialization.
Use the existing **`synonym-52 / pubky-marketplace`** project; do not run the setup wizard or add a
second SDK. The embedded Shop has its own runtime config and SDK inside the iframe, so its events
go to the Shop DSN even when Pubky App serves the parent page on the same origin.

## Deployment checklist

Set these on the **Shop container**, keeping the existing network and embedded configuration:

```dotenv
PUBKY_RUNTIME_SENTRY_DSN=<DSN from synonym-52 / pubky-marketplace>
PUBKY_RUNTIME_SENTRY_ENVIRONMENT=staging
PUBKY_RUNTIME_SENTRY_TRACES_SAMPLE_RATE=0.1
PUBKY_RUNTIME_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.0
PUBKY_RUNTIME_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0
```

The DSN is a public client key, available in the project's **Settings → Client Keys (DSN)**.
It is not the upload auth token. Set the environment to `production` for the production deployment.
Staging uses `PUBKY_RUNTIME_TESTNET=false`; the testnet switch is for test networks and disables
Sentry. Do not change the homeserver/network settings to enable telemetry.

For readable production stack traces, the **Shop image build** also needs:

- `SENTRY_ORG=synonym-52`
- `SENTRY_PROJECT=pubky-marketplace`
- `SENTRY_AUTH_TOKEN` from the CI secret store, authorized to upload source maps and manage releases
  (`org:ci` for an organization token, or `org:read` plus `project:releases` for a personal token)
- `NEXT_PUBLIC_APP_VERSION` set to the full SHA of the Shop commit being built, not the infra repo's SHA

The Dockerfile creates the release, associates `pubky/pubky-marketplace@<Shop SHA>` and uploads the
maps for that exact build. These steps fail the image build if Sentry rejects them. Without
upload credentials, errors still arrive but browser stack traces may remain minified. Never expose
the auth token in `PUBKY_RUNTIME_*` or `NEXT_PUBLIC_*` variables. Runtime DSN changes require a
container restart/redeploy, not a new frontend build; uploading maps requires the build artifacts.

The staging image is built through **`pubky/shop-migration`**. Its maintainer must wire the runtime
values and build credentials there. The copied `build-docker-image.yml` in this repo is gated to
`pubky/pubky-app` and does not configure Marketplace deployments.

After deployment, verify capture with the mounted harness described below. This config covers the
Shop's Next.js server/BFF as well as its browser; it does not instrument the separate marketplace
service, Locks or Paykit processes.

## Releases

Every event's `release` is the **deployed commit's full SHA**, baked into the build as
`NEXT_PUBLIC_APP_VERSION` for the browser, Node and Edge runtimes alike (`resolveSentryRelease` in
`src/libs/build-info/build-info.ts`):

| Deploy path                                         | Release taken from                                                         | Release created by                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Docker image built by `shop-migration`              | the `NEXT_PUBLIC_APP_VERSION` build arg, the Shop submodule commit         | the Dockerfile, when Sentry build credentials are present |
| Docker image from a `v*` tag (`release-docker.yml`) | the `NEXT_PUBLIC_APP_VERSION` build arg, the tagged commit                 | the workflow's `sentry-release` job                       |
| Vercel (John Staging, John Prod)                    | `GIT_COMMIT` (`--build-env` on a CLI deploy), else `VERCEL_GIT_COMMIT_SHA` | the build command in `vercel.json`                        |
| Local build                                         | the package version                                                        | nobody                                                    |

`scripts/sentry-release` creates the release under that exact name, associates its commits and
finalizes it. On Vercel it also records the deploy under the environment the events carry
(`PUBKY_RUNTIME_SENTRY_ENVIRONMENT`, else `production`). With commits attached, stack-trace links open
each file at the deployed commit, and suspect commits and `Fixes <ISSUE>` resolution work. The script
skips with a warning while `SENTRY_AUTH_TOKEN` is unset. On Vercel a Sentry failure is printed in the
build log and never blocks the deploy; in the tag-release workflow it fails the `sentry-release` job (the
image is already pushed). The `withSentryConfig` plugin creates no releases: in webpack builds it would
create one per compiler.

The credentialed Docker build runs the same script with `--no-git` before uploading maps. That flag
names the Shop repository and baked-in SHA explicitly, so no Git history or enclosing infra checkout
is used. A failure exits the build before the source-map upload; builds without the Sentry credentials
skip both steps. No deploy is recorded during the build: the same image can be promoted to staging
and production later.

**Prerequisite (Sentry admin):** commit association resolves only once `pubky/pubky-marketplace` is
added to the Sentry GitHub integration: **Settings → Integrations → GitHub → Configure → Add
Repository**, with the Sentry GitHub App granted access to the repository in the `pubky` org, and a
code mapping for the `pubky-marketplace` project on branch `master` (**Code Mappings → Add Mapping**).
`sentry-cli repos list` then prints `pubky/pubky-marketplace`. Until then `set-commits` fails while the
release is still created, finalized and (on Vercel) deployed. The tag-release job uses `set-commits --auto`
on a full-history checkout. Docker builds and Vercel CLI uploads name the commit explicitly. Sentry
fetches the range from the previous release when available; for the first release, the GitHub
integration fetches recent commits ending at the supplied SHA. A Vercel git deployment can supply
`VERCEL_GIT_PREVIOUS_SHA` as the range start.

Credentials, never committed and never in `PUBKY_RUNTIME_*` or `NEXT_PUBLIC_*`:

- Docker builds in `pubky/shop-migration`: its `SENTRY_AUTH_TOKEN` CI secret is passed with
  `SENTRY_ORG=synonym-52`, `SENTRY_PROJECT=pubky-marketplace` and the Shop submodule's full SHA as
  `NEXT_PUBLIC_APP_VERSION`. No additional build input is needed for commit association.
- GitHub Actions secret `SENTRY_AUTH_TOKEN` on `pubky/pubky-marketplace`: a `synonym-52` organization
  auth token (Settings → Developer Settings → Organization Tokens). The workflow sets the org and
  project.
- Vercel, in each project that should create releases: `SENTRY_AUTH_TOKEN` (sensitive),
  `SENTRY_ORG=synonym-52` and `SENTRY_PROJECT=pubky-marketplace`. Leave `NEXT_PUBLIC_APP_VERSION`
  unset there: it would replace the commit SHA.

The GCP deployment records its own deploys, because the image is promoted across environments. After
an image is live, run this with the image's commit SHA and the container's
`PUBKY_RUNTIME_SENTRY_ENVIRONMENT`:

```bash
SENTRY_AUTH_TOKEN=<token> npx @sentry/cli@2.58.5 deploys new --org synonym-52 --project pubky-marketplace \
  --release <commit SHA> --env <staging|production>
```

## What is captured

| Source                                               | Mechanism                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `Err.*` factory call                           | `captureAppError(error)` inside `createAppError()` (one call per AppError; structured tags: `error.category`, `error.code`, `error.service`, `error.operation`, `error.trace_id`) |
| Unhandled browser JS exceptions                      | Sentry `globalHandlers` integration (auto)                                                                                                                                        |
| Unhandled promise rejections                         | Sentry `globalHandlers` integration (auto)                                                                                                                                        |
| Server Component / Route Handler / middleware errors | `onRequestError = Sentry.captureRequestError` exported from `src/instrumentation.ts` (Next.js 15+)                                                                                |
| Caught Shop grant BFF server failures                | Browser/CLI route handlers report mapped 5xx through `Err.server` with safe metadata only. Mapped 4xx and 429 are not reported by this server path.                               |
| Route segment render errors                          | `Sentry.captureException(error)` in the `useEffect` of `src/app/error.tsx`                                                                                                        |
| Root layout render errors                            | `Sentry.captureException(error)` in the `useEffect` of `src/app/global-error.tsx`                                                                                                 |
| Replay (masked)                                      | `replayIntegration({ maskAllText, blockAllMedia, maskAllInputs })` on errored sessions                                                                                            |

## Capture rule

BFF events include the operation, mapped HTTP status and a fixed `kind` derived from the error class.
Marketplace service errors also include their numeric `upstreamStatus`. Original messages, names,
stacks, causes, upstream error codes and SQL details are never forwarded; unrecognized errors use `unknown`.

A failed BFF request can intentionally produce both a browser event and a server event. The browser
records the failed operation; the server adds the failure category and also covers CLI requests and
best-effort cancellation/session cleanup paths that do not report failed responses in the browser.

> Throw via `Err.*` factories. Do **not** call `Sentry.captureException` directly anywhere except `app/error.tsx` and `app/global-error.tsx`, and in those two files only for non-`AppError` instances.

The `Err.*` factories already log once and capture once — adding extra `Sentry.captureException` calls causes duplicate issues in the dashboard. Anything that bubbles to the browser global handler or the server `onRequestError` hook is captured automatically by the SDK.

Expected user-flow states are not failures and must not reach the factory:

- A homeserver file that may not exist yet (profile, settings, last read, legacy watchlist, an own review, a
  listing before its first publish or while its read-back lags, a seller's `shop.json` before they publish a storefront) is read with `HomeserverService.getJsonIfFound` / `CommerceHomeserverService.fetchJsonIfFound`, which answer
  `{ found: false }` before any error is created. Do not read it with `request` and catch the 404.
- A state the UI answers with a prompt (no marketplace session yet, approval in progress) is built with `new AppError(...)`, as in `marketplace-approval-failure.ts`. Server answers
  (401, 5xx) for the same flows stay on `Err.*`.
- A grant approval whose flow cookie now binds another approval or none (`flow_binding_missing` 401,
  `flow_binding_denied` 403: another tab started one, or it expired) is built the same way, in `marketplace-approval-failure.ts`.
- A marketplace service without store connectors (`404 connectors_disabled`, or a bare 404/405 from a service
  older than the connector routes) is built with `new AppError(...)` in `MarketplaceConnectorsService`: the
  Shop hides store connections there. A connector 404 that names another refusal stays on `Err.*`.
- Marketplace media its owner has removed (404/410 from the owner's homeserver) is built the same way in
  `MarketplaceMediaService.fetchMedia`: the UI shows no image. Other media failures stay on `Err.*`.
- A Shop-owned sign-in started while the Shop is embedded in Pubky App ("Continue sign-in in Pubky App.",
  `AuthController.assertStandaloneMode`) is also built with `new AppError(...)`: App owns sign-in there.

The two route-segment error boundaries (`app/error.tsx`, `app/global-error.tsx`) guard their `Sentry.captureException` call with `if (!(error instanceof AppError))` so an `AppError` thrown during render isn't captured twice (once by the factory, once by the boundary).

For future Server Actions, wrap with `Sentry.withServerActionInstrumentation('actionName', { headers: await headers() }, async () => { ... })` so server-action errors are captured and traces stitch with the client.

### OG metadata enrichment

`/api/og-metadata` is best-effort link-preview enrichment. Expected external outcomes should normally be handled before
`Err.*` creation so they do not create Sentry issues:

- Expected remote failures such as forbidden/not-found/gone pages, non-HTML content, DNS failure, network failure,
  timeout, rate limiting, or remote 5xx return fallback metadata.
- Invalid user URLs return a normal `400` response from the controller/route without `Err.validation`.
- `og:image` normalization uses non-throwing DNS safety checks, so invalid image URLs, DNS failures, and private image
  IPs simply remove the image from otherwise valid page metadata.
- Security/anomaly cases on the main page fetch path, such as private IPs, non-HTTP redirects, redirect loops, oversized
  bodies, and parser/runtime surprises remain reportable through `Err.*`.

Fallback paths use `Logger.warn`, which is currently platform/server logging. Sentry Logs are disabled in this app, so
these warnings are not Sentry aggregate events unless logging infrastructure is enabled separately.

### Known quirk: render-time errors emit 2 events in React 19

When an `AppError` is thrown synchronously during React render (as opposed to event handlers, effects, or application-layer code), React 19 attempts to re-render the failing component once before handing off to the error boundary. Each render invocation runs the `throw Err.*(...)` expression afresh, constructing a new `AppError` and routing through `captureAppError` — producing **2 Sentry events** within ~30 ms.

Both events share identical fingerprints, so Sentry groups them into a **single issue** — triage and alerting are unaffected, only the raw event count is inflated. This pathology is limited to synchronous render throws; event-handler, effect, Server Action, and application-layer throws all emit exactly one event.

See [React 19's `onRecoverableError` docs](https://react.dev/reference/react-dom/client/createRoot#parameters) for the retry semantics. If event-quota inflation ever becomes a concern, the fix is a short-window LRU in `captureAppError` keyed on `${service}:${operation}:${message}`.

## Files

- `src/instrumentation.ts` — server runtime dispatch + `onRequestError` + boot-time runtime-config fail-fast
- `src/instrumentation-client.ts` — browser init + Replay + `onRouterTransitionStart`
- `src/sentry.server.config.ts` / `src/sentry.edge.config.ts` — runtime-specific init
- `src/libs/observability/sentry.ts` — single source of truth (`shouldEnableSentry`, `getSentryInitBase`, `captureAppError`). Sentry is off when `NODE_ENV=test`, `VITEST` is set, the **runtime** config has `testnet=true`, or no **runtime** DSN is configured. If the runtime config cannot be resolved at all, the gate returns `false` instead of throwing (the capture funnel must never mask the original boot error).
- `src/libs/error/error.factories.ts` — `createAppError()` calls `captureAppError(error)` after `Logger.error`
- `next.config.ts` — wrapped by `withSentryConfig(...)` for SDK wiring only; source-map upload and release creation are disabled (see below)
- `src/libs/build-info/build-info.ts` — `resolveSentryRelease`, the release name baked into the build
- `scripts/sentry-release/` — creates the release, sets its commits, finalizes it and records Vercel deploys ([Releases](#releases))

## Environment variables

All Sentry values are part of the **optional runtime-config tier** ([ADR 0018](adr/0018-runtime-sentry-and-decoupled-source-maps.md)): set `PUBKY_RUNTIME_SENTRY_*` on the deployed container, or in `.env.local` for local dev. Schema and defaults live in `src/libs/runtime-config/runtime-config.schema.ts`.

| Variable                                            | Runtime                 | Required?                                                  |
| --------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `PUBKY_RUNTIME_SENTRY_DSN`                          | browser + server + edge | Optional. Empty/unset disables Sentry entirely.            |
| `PUBKY_RUNTIME_SENTRY_ENVIRONMENT`                  | all                     | Optional. Defaults to `NODE_ENV`.                          |
| `PUBKY_RUNTIME_TESTNET`                             | all                     | When `true`, Sentry is disabled (CI E2E / testnet deploy). |
| `PUBKY_RUNTIME_SENTRY_TRACES_SAMPLE_RATE`           | all                     | Optional. Default `0.1`.                                   |
| `PUBKY_RUNTIME_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`  | browser                 | Optional. Default `0.0` (record only on error).            |
| `PUBKY_RUNTIME_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | browser                 | Optional. Default `1.0`.                                   |

`SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are optional build inputs: the Dockerfile uses them for release creation, commit association and source-map upload ([Releases](#releases)). They are never app runtime config and are not required to build or run the public image. The release tag comes from `NEXT_PUBLIC_APP_VERSION`, the deployed commit SHA on Vercel and in Docker CI (so SDK events, uploaded maps and the created release share one name); local builds fall back to the package version.

## Source maps

The public Docker image remains buildable **without** Sentry credentials. Docker builds always inject Debug IDs, and upload source maps only when Sentry build credentials are provided ([ADR 0018](adr/0018-runtime-sentry-and-decoupled-source-maps.md)):

1. `next.config.ts` generates maps for every build (`productionBrowserSourceMaps` + `experimental.serverSourceMaps`) and disables the plugin upload (`sourcemaps.disable: true`, `release.create: false`).
2. The Dockerfile builder stage runs `npx sentry-cli sourcemaps inject` over `.next` and over the nested `.next/standalone/.next` (hidden directories are skipped by the walker) — offline, deterministic Debug-ID stamping of chunks and maps.
3. If `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are present, the Dockerfile runs `scripts/sentry-release/main.ts --no-git` to associate the exact Shop commit, then uploads `.next` source maps with `--release="$NEXT_PUBLIC_APP_VERSION"`.
4. The runner stage deletes `*.map` under `.next/static` (browser maps must not be publicly served); standalone server maps stay for readable Node stack traces.

Third-party deployers get unsymbolicated events unless they obtain the maps for their image version and upload them to their own org (publishing maps as a release artifact is the recommended follow-up).

## Privacy

Shop retains the App's privacy defaults:

- `sendDefaultPii: false`; the scrubber below also removes sensitive fields from captured payloads
- Replay: `maskAllText: true`, `maskAllInputs: true`, `blockAllMedia: true`, `networkCaptureBodies: false`
- `beforeSend` defensively redacts user identifiers and user-provided data from app-controlled payloads:
  `email`, `phone` / `phoneNumber`, `name`, `firstName`, `lastName`, `displayName`, `username`, `bio`, `file`,
  `user`, `cookie` / `cookies`, raw Pubky public keys, `pubky://...` URIs, compact Pubky URLs, and `_pubky.`
  HTTP hostnames. The same bounded recursive scrubber covers `tags`, `fingerprint`, `threads`, and
  `measurements`, including runtime payload shapes outside the SDK's static types.
- `captureAppError()` sanitizes `error.context` before attaching it to Sentry. New `Err.*` contexts must avoid raw user
  data unless the key is covered by the scrubber in `src/libs/observability/sentry.ts`.

Never call `Sentry.setUser({ email, ... })`. If user attribution is ever needed, use the user's Pubky public key as `id` only.

### Tracing scrubbing (`beforeSendTransaction`, `beforeSendSpan`)

Tracing payloads carry user-controlled URL strings (route names, fetch URLs, root-span data) that
the error-only `beforeSend` does not see. Two additional hooks in `src/libs/observability/sentry.ts`
cover them:

- **Bounded recursive walker** applies pattern and sensitive-key redaction to `event.request`,
  `event.contexts`, `event.extra`, `event.user`, `event.tags`, `event.fingerprint`, `event.threads`,
  and `event.measurements`.
- Transaction names and span descriptions receive pattern scrubbing; `span.data` receives the same
  bounded recursive scrub.

SDK-structural context names (`browser`, `runtime`, `os`, `device`) are preserved after their string
values are pattern-scrubbed. `event.spans[]` remains delegated to `beforeSendSpan`; double-walking
would be redundant and risks double-scrubbing.

## Disabled / deferred features

| Feature                      | Status   | Why                                                                                                 |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Sentry Logs                  | Disabled | Repo uses a custom `Logger`; routing through `Sentry.logger.*` adds no value today.                 |
| Profiling                    | Disabled | Requires `Document-Policy: js-profiling` header; revisit if performance hunts need it.              |
| AI Monitoring                | N/A      | No OpenAI/Anthropic/Vercel AI SDK calls in this codebase.                                           |
| Crons                        | N/A      | No scheduled jobs.                                                                                  |
| `tunnelRoute: '/monitoring'` | Deferred | Would require adding `middleware.ts` to exclude the path. Revisit if Sentry shows ad-blocker drops. |

## Verification

To verify a deployment, open the `/sentry-test` harness on standalone Shop, or
`/shop/sentry-test` through the App wrapper when Shop is mounted at `/shop-embed`. The iframe
document is `/shop-embed/sentry-test`, and its server triggers must call
`/shop-embed/api/sentry-test`, not Pubky App's root `/api/sentry-test`. The harness is reachable
outside the `production` Sentry environment; set the explicit `staging` environment above.
Trigger each capture path. The diagnostics card shows the resolved runtime
settings, including **Client SDK initialized** (`Sentry.getClient()`), which catches the
silent-failure mode where Sentry is enabled but the browser SDK never initialized because
`window.__PUBKY_CONFIG__` was not injected before `instrumentation-client.ts` evaluated.

Then inspect recent events in **`pubky-marketplace`** for the configured environment and confirm the
**source maps** resolve (original `.tsx`/`.ts` frames, not minified bundle names) and the **`release`**
tag is the deployed commit's full SHA (`GET /api/build` reports its first 12 characters). Open that
release in Sentry and confirm it lists its commits and, for a Vercel deployment, a deploy in the
configured environment.
