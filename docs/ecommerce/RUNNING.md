# Running the Marketplace Locally

How to get the marketplace working on your machine so you can click through it as a user. Every command here was run and verified; nothing in this file is aspirational.

Read [`status.md`](status.md) first if you want to know which parts are real and which are simulated before you start. New to the Shop: start with [`onboarding.md`](onboarding.md). Shipping a release: [`release.md`](release.md).

## TL;DR

```bash
HUSKY=0 npm ci   # HUSKY=0 keeps husky's prepare script from replacing your global git hooks

# terminal 1 — sandbox transaction service
npm run marketplace:dev

# terminal 2 — the app, with commerce switched on
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=sandbox \
PUBKY_RUNTIME_MARKETPLACE_URL=http://localhost:3100 \
NEXT_PUBLIC_DB_NAME=franky-marketplace-sandbox \
npm run dev
```

Then sign in (the seed page is auth-gated on top of the adapter-mode gate), open <http://localhost:3000/marketplace/sandbox>, and press **Seed sandbox catalog**. Browse from <http://localhost:3000/marketplace>. The seeded catalog lives in the signed-in account's local database, so each account seeds its own copy.

Keep the sandbox database name separate from staging's database name. Changing
the adapter mode does not clear or isolate an existing browser cache. The seed
action preserves a database containing other listings and reports that it was
skipped; it reports ready only after the demo listings register with the local
transaction service. Existing demos can be registered again after that service
restarts. Do not clear site data to switch modes: that can remove local drafts.

## Why commerce is off unless you ask for it

`commerceAdapterMode` defaults to `unavailable`. In that mode the marketplace routes exist but no transactional command can be issued and the Marketplace entry does not appear in navigation, so a normal deployment is unaffected by any of this work. You have to opt in explicitly, per ADR 0019.

The four modes:

| Mode                    | Behavior                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable` (default) | Browse-only. No commands. No nav entry. Fails closed.                                                                                                                                                                                                                                                                                                                                    |
| `sandbox`               | Full click-through against the in-memory service. Everything transactional is simulated and labeled.                                                                                                                                                                                                                                                                                     |
| `transaction-service`   | Commands and reads go to the durable Rust service with real Pubky AuthToken sessions. Authoritative outcomes and an interactive shopping UI; establishing the session is a signer approval started from the in-app "Connect marketplace session" dialog (QR or Pubky Ring deeplink) — see below.                                                                                         |
| `locks-paykit`          | Everything `transaction-service` does, PLUS the real Locks/Paykit payment rails. The modes compose rather than exclude: the durable service stays the transactional authority (its worker independently verifies the Locks lifecycle and confirms payments); the client additionally submits the buyer's proof bundle and registers the correlation. See "Running a real payment" below. |

## Verifying the service is up

```bash
curl -s localhost:3100/health/live    # {"status":"live"}
curl -s localhost:3100/health/ready   # {"status":"ready","mode":"sandbox","storage":"memory"}
```

`storage: memory` is not a bug — this service holds all transactional state in memory and loses it on restart. That is what makes it a sandbox. Re-seed after restarting it.

## What you can click through

With sandbox mode on and the catalog seeded:

- browse, filter, and search the catalog; open a listing; view a seller's shop
- favorite listings and follow shops
- create and publish a listing (this writes a **real record to your homeserver**)
- add to cart and check out
- make and counter offers; bid on auctions
- advance a payment through its states using the visibly-labeled simulate buttons
- act on orders (ship, deliver, cancel, return)
- message a seller, including image attachments
- read notifications and set preferences

## Seeding

Demo data is opt-in and lives behind `/marketplace/sandbox`, which returns 404 unless the deployment is explicitly in sandbox mode. The seeded sellers are fictional (`'y'.repeat(52)` and friends), which is exactly why the page is gated — those records must never appear in a real catalog.

## Nexus discovery

In every mode **except sandbox**, the catalog refreshes itself from the Nexus marketplace index: it reads the listing stream (`GET /v0/stream/listings`), which carries the full card projection, and stores validated index entries directly — the canonical record is fetched from the seller's homeserver only when a listing is opened (or when the index has seen a newer revision than the cache; the homeserver stays canonical per ADR 0020). The catalog always renders from the local cache first; when Nexus is unreachable or does not serve the marketplace endpoints, the refresh fails quietly and browsing continues cache-only.

**Sandbox mode never queries Nexus.** The sandbox catalog is a self-contained demo seeded with fictional sellers, and mixing indexed network listings into it would blend real and simulated content — so with `commerceAdapterMode=sandbox` the browsing flow above works exactly as described with no Nexus involved.

The marketplace endpoints are implemented on the `main` branch of [`pubky/marketplace-nexus`](https://github.com/pubky/marketplace-nexus) (the earlier fork `BitcoinErrorLog/pubky-nexus` is frozen) and are deployed as a **dedicated marketplace-indexing Nexus on Railway** (`https://nexusd-production-7108.up.railway.app`, runbook in that repository's `docs/railway-deploy.md`), which both the production and the staging Shop reach through the override below. The **official** staging Nexus the app points at by default still has no marketplace endpoints — against it the listing stream 404s and the catalog stays cache-only.

Because a dedicated marketplace-indexing Nexus is deployed separately from the main social Nexus, the app supports an **optional marketplace-only override**: set `PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL` to route ONLY the commerce/marketplace index reads at that deployment — listing stream and details, listing/shop tags, shop reviews/reputation, and the drops stream — while every social surface (posts, users, tags, files, streams, search) keeps using `PUBKY_RUNTIME_NEXUS_URL`. When the override is unset, marketplace reads fall back to the main `nexusUrl` — the variable is genuinely optional, including under the strict deployed-mode config parse. (Pointing the whole app at a marketplace-indexing Nexus with `PUBKY_RUNTIME_NEXUS_URL` still works for a single-Nexus setup.)

## Shared pubky.app sign-in (vibe session consumer)

**Off in both live Shop builds.** The production and staging deployments are built with `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` unset, so the Shop uses only its own sign-in, makes no `/session-bridge` request, and ignores a `#s=` hand-off link. Keep them unset. The cookie bridge shares one homeserver cookie between sites, and cookie sessions are deprecated by the homeserver, so it is not the path to single sign-on with pubky.app.

The consumer code remains (ADR 0029): the two variables are **build-time** values, baked into the artifact at `npm run build` — not `PUBKY_RUNTIME_*` values — and consumer mode turns on only when the bridge origin is set (an exact origin such as `https://pubky.app`; `http://localhost:<port>` is accepted only outside production builds). A bridged restore never auto-triggers a re-approval, and the staging homeserver guard still runs on every restore when `PUBKY_RUNTIME_ENV=staging`.

## Dev server hygiene

Turbopack's persistent cache under `.next` grows with every rebuild and, after a large merge or a long session, can leave the dev server pegging every core or serving a stale module graph (pages stuck on the app loader, `Module … was instantiated` errors in the console, IndexedDB "object store not found" in a fresh browser context). Stop the server, delete `.next`, and start it again; a cold compile takes a minute or two. Do this after any merge of `master` before trusting a browser or e2e run.

## Running the tests

```bash
bash scripts/prepush.sh                             # the pre-push gate: changed-file prettier/eslint, typecheck, related tests
npm run typecheck
npm run lint
npm run test                                        # the whole unit suite
npm run test:marketplace                            # sandbox service
npm run test:marketplace:service                    # durable Rust service transport, needs it running (see below)
npm run test:marketplace:locks                      # LIVE real-payment purchase, needs the composed stack (see below)
npm run test:marketplace:drops                      # LIVE FCFS drop race on the deployed staging stack (see below)
npm run test:e2e:launch-critical                    # launch-critical browser journey (CI runs it as launch-e2e)
bash scripts/vrt-linux.sh [spec...]                 # Linux visual regression in Docker (npm run test:vrt is the same)
```

Run `bash scripts/prepush.sh` before every push; its last line is `PREPUSH OK <sha> <seconds> fast`. Releases use `PREPUSH_FULL=1 bash scripts/prepush.sh`, which adds Linux VRT for every spec that renders a changed file.

VRT runs in the pinned Playwright container (`mcr.microsoft.com/playwright:v1.60.0-noble`), so it needs Docker but no local browsers. Only Linux baselines (`*-linux.png`) are committed and gate merges. Regenerate them for the specs you changed with `VRT_LINUX_UPDATE=1 bash scripts/vrt-linux.sh <spec...>` followed by `bash scripts/vrt-revert-outside.sh <spec...>`, or with the **VRT Update Baselines** workflow; the rules are in [`release.md`](release.md#visual-regression-baselines). No `TZ` env var is needed (or honored as a mechanism): the VRT harness freezes the system clock and pins the default formatting time zone to UTC in every browser — including WebKit, which ignores `TZ` — so timestamped surfaces render identically locally and in CI. See the "Time determinism" block in `src/test-utils/vrt.setup.ts` for the rules.

## Running the marketplace E2E journeys

`cypress/e2e/marketplace.cy.ts` drives the buyer, seller, and bidder journeys through the browser against the sandbox adapter. The browser user performs every step a real user can perform in the UI; counterparty identities that cannot hold a browser session (a seeded fictional seller and a scripted buyer) act through the sandbox service's own HTTP API using its actual identity model — the trusted `x-pubky-actor` header.

It needs three local services:

```bash
# 1. A local pubky testnet (homeserver + pkarr relay + http relay) with
#    token-required signup, so onboarding's invite-code step works.
cargo install pubky-testnet
cat > /tmp/pubky-homeserver-e2e.toml <<'EOF'
[general]
signup_mode = "token_required"
database_url = "postgres://postgres:postgres@localhost:5432/postgres?pubky-test=true"

[storage]
type = "in_memory"
EOF
pubky-testnet --homeserver-config /tmp/pubky-homeserver-e2e.toml

# 2. A FRESH sandbox transaction service. Its state is in-memory and the spec
#    assumes seeded quantities, so restart it before every run.
MARKETPLACE_MODE=sandbox npm run marketplace:start

# 3. The app, pointed at both.
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=sandbox \
PUBKY_RUNTIME_MARKETPLACE_URL=http://localhost:3100 \
PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 \
PUBKY_RUNTIME_TESTNET=true \
PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/inbox/ \
npm run dev

# then
npx cypress run -P cypress --browser chrome --spec cypress/e2e/marketplace.cy.ts
```

The homeserver admin endpoint on port 6288 matches the Cypress defaults (`HOMESERVER_ADMIN_URL`, password `admin`), so invite codes are minted automatically. Nexus is not needed: sandbox mode never queries it, and the feed pages degrade gracefully. One consequence of not running a local Nexus is that the post-onboarding welcome dialog (which renders only after the new user's details sync back from Nexus) legitimately never appears — the marketplace onboarding helper treats it as optional and says why.

## Running against the durable transaction service

`services/marketplace/` is the **sandbox adapter only**. The real, durable transaction service is a separate Rust service with PostgreSQL persistence and real Pubky AuthToken authentication:

<https://github.com/pubky/pubky-marketplace-service>

```bash
git clone https://github.com/pubky/pubky-marketplace-service
cd pubky-marketplace-service
docker compose up -d --wait
export DATABASE_URL='postgres://marketplace:marketplace@localhost:55432/marketplace'
cargo test --workspace   # optional but recommended
cargo run -p marketplace-service   # listens on 127.0.0.1:8080
```

Then run the app against it:

```bash
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=transaction-service \
PUBKY_RUNTIME_MARKETPLACE_URL=http://127.0.0.1:8080 \
npm run dev
```

The client selects a wholly different transport in this mode (`MarketplaceTransactionService`):

- **Auth is real.** A session is established by POSTing a Pubky `AuthToken` (obtained through the SDK auth flow after signer approval — see [`service-auth.md`](service-auth.md)) to `/v1/auth/sessions`; commands carry the returned opaque token as `Authorization: Bearer`. The forgeable `x-pubky-actor` header does not exist on this path. The bearer token lives in memory plus a `localStorage` mirror so reloads, new tabs, and browser restarts do not force a fresh signer approval — never in IndexedDB, cookies, or logs — and is dropped on sign-out, account switch, and expiry (see `service-auth.md` for the storage contract and tradeoff).
- **Wire casing is snake_case** per ADR 0019 §3; the client converts its camelCase contracts at the transport boundary in both directions.
- **The ported command set is accepted** — listings, offers, bids, checkout, order cancellation, fulfillment, returns, external-refund evidence, and reviews. Kinds the durable service does not implement (`payment.sandbox_advance`, the sandbox's plaintext `message.send`, notification read state/preferences) are rejected client-side before any bytes are sent, and the UI withholds those affordances in this mode.
- **Reads come from the service's role-scoped projections** (listings, offers, orders with embedded payment/shipment/return/refund/review sub-objects, payments, receipts, and notifications). The interactive shopping UI sources every `expected_revision` from a fresh projection read and treats `REVISION_CONFLICT` as refetch-and-retry.

### Connecting the session from the UI

Durable-mode screens that need a session (orders, offers, notifications, the cart's checkout, listing negotiation state) render a **"Connect marketplace session"** card instead of a dead end. Clicking it opens a dialog that:

1. states what approval authorizes (a marketplace session: the app may transact as you against the transaction service until it expires or you sign out),
2. shows the flow's `pubkyauth://` authorization URL as a QR — scan it with Pubky Ring on another device — plus an "Open in Pubky Ring" deeplink for same-device Ring and a copy affordance,
3. waits for the approval (cancellable; closing the dialog frees the flow), and
4. on approval exchanges the AuthToken for the bearer session and refetches the surfaces that were waiting on it.

If the flow fails (relay timeout, rejected token, unreachable service) the dialog shows the transport's actual error and a "Try again" that begins a fresh flow — AuthTokens are single-use, so a failed flow's QR is never reused. A connect attempt that is never approved times out after two minutes with the same visible-error-plus-retry treatment, so the dialog can never sit in "waiting for approval" forever on a dead relay channel; closing and reopening the dialog likewise cancels the old flow and mints a fresh QR (an old QR from a previous open is dead — scanning it approves into a freed flow and connects nothing). Once connected, the session survives page reloads, new tabs, and browser restarts (`localStorage`, bounded by the service-side TTL); another device still needs its own approval. When a session later expires (or the service answers 401 — including for a restored token the service no longer accepts), the same card resurfaces in place; reconnecting requires a fresh signer approval by design (see `service-auth.md`). The signer approval itself needs a device running Pubky Ring; the integration suite below proves the same transport programmatically with a throwaway keypair.

To prove the transport against the running service (session establishment, snake_case commands, idempotent replay, revision conflicts, report reads):

```bash
npm run test:marketplace:service
```

This integration suite uses no mocks: it runs a genuine Pubky auth flow (acting as the signer with a throwaway keypair), needs the service on `127.0.0.1:8080` (override with `MARKETPLACE_SERVICE_URL`) and network access to the Pubky HTTP relay. It is intentionally not part of the unit gates.

The client's state tables are held in lockstep with the service's canonical contract: `contracts/state-machines.json` from the service repo is vendored at `src/libs/commerce/contracts/state-machines.json`, and `src/libs/commerce/state-machines.contract.test.ts` fails CI on any drift. When the service contract changes, re-vendor the file and reconcile the TypeScript — the service is canonical.

### Chat (every mode)

Buyer↔seller chat does not depend on the commerce adapter mode: it needs a signed-in session holding the chat scopes (`/pub/chat/v0/:rw`, `/priv/chat/v0/:rw`, part of the sign-in grant) and the homeserver. Each message is an end-to-end encrypted file on the sender's own homeserver; delivery runs on the peer homeserver's event stream, optional `pubky/inbox` pings and reconciliation. Design and threat model: [`../chat/README.md`](../chat/README.md); decision: [ADR 0030](../adr/0030-chat-transport.md).

Facts to know: a session approved before the chat scopes existed shows "Messages need a newer sign-in approval" until the user signs in again; a message to someone who has not set up messages yet stays queued ("Waiting for them to set up messages") and goes out once their key is published; the inbox (`PUBKY_RUNTIME_INBOX_URL`) is what makes a stranger's first message arrive at once, and it needs a grant session (Bitkit, Ring grant, Passport) because a Ring cookie session cannot sign the inbox proof; without it chat still works through streams and reconciliation. History and read state follow the account to other devices. One message is at most 4,096 bytes; no attachments.

To run chat against a local Pubky testnet with an inbox, start the stack from [pubky-docker](https://github.com/pubky/pubky-docker) and an inbox container built from the `pubky/inbox` Dockerfile (full recipe in [`../chat/README.md`](../chat/README.md), "Local development"):

```bash
docker run -d --name pubky-inbox-dev --network pubky-docker_pubky -p 8088:8080 \
  -e INBOX_DATABASE__URL=postgres://test_user:test_pass@postgres:5432/inbox -e INBOX_AUTH__AUDIENCE=http://localhost:8088 \
  -e 'INBOX_SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:3000"]' -v pubky-inbox-dev-data:/data pubky-inbox:dev

PUBKY_RUNTIME_TESTNET=true PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080 \
PUBKY_RUNTIME_CDN_URL=http://localhost:8080/static PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/inbox/ \
PUBKY_RUNTIME_INBOX_URL=http://localhost:8088 PUBKY_RUNTIME_INBOX_AUDIENCE=http://localhost:8088 npm run dev
```

The dev signup-token route needs `HOMESERVER_ADMIN_URL=http://localhost:6288/generate_signup_token` and `HOMESERVER_ADMIN_PASSWORD=admin`.

To prove chat live — two accounts, real crypto, real homeserver — against that stack (dev server, homeserver and inbox container running):

```bash
npm run test:e2e:chat
```

The script (`src/test/e2e/chat-two-accounts.mjs`) drives two Playwright browser contexts signed in through the grant sign-in link with a Node-side signer, and checks: keys published, a message reaches the other thread, a reply reaches the open thread live, thread order, the unread badge appears and clears on read, both tabs hold an inbox session, a ping-only delivery with the event stream blocked, history survives a reload, a fresh browser context rebuilds the conversation from the homeservers, the published key file carries no secret, and the message files on the homeserver are ciphertext. Where Playwright cannot install its own browser, set `CHROMIUM_PATH` to an existing `chrome-headless-shell`. It is intentionally not part of the unit gates.

## Cross-account live proof (stranger reads a published listing)

The serialized-nulls bug — every published listing unloadable by anyone except its cached seller — shipped because no test ever viewed a listing as a **stranger**: every test either read its own writes back from the local cache or used already-normalized fixtures. This suite makes the stranger journey a first-class live proof against the REAL staging homeserver:

1. Identity A signs up, uploads real media bytes, and publishes a listing through the real create path — with the wire record carrying the exact explicit nulls shipped studios serialize (`region: null`, `sku: null`, `priceOverride: null`); the suite verifies the nulls are really in the raw homeserver JSON. A also publishes their shop record.
2. The local IndexedDB cache is destroyed, identity B signs up fresh, and the suite asserts B's cache is empty.
3. B loads the listing through the REAL read path (`getOrFetchListing` → homeserver fetch → normalizer) and asserts the parsed record is renders-ready: nulls normalized to honest absences, title/price/condition format, the media URL resolves to a fetchable HTTPS URL with the published content hash, and the read populated B's local-first cache.
4. B loads A's shop page data the way `MarketplaceShop.tsx` does: the canonical shop record, the tolerated Nexus seller-catalog refresh, and the local-first seller listings.

The staging homeserver requires single-use signup tokens, so this is a run-on-demand suite, never a standing gate. Generate two tokens from the staging homeserver admin endpoint (`GET https://admin.homeserver.staging.pubky.app/generate_signup_token` with the `X-Admin-Password` header — the password is intentionally not written down in this repo; ask the team), then:

```bash
MARKETPLACE_STAGING_SIGNUP_TOKEN_A=XXXX-XXXX-XXXX \
MARKETPLACE_STAGING_SIGNUP_TOKEN_B=YYYY-YYYY-YYYY \
npm run test:marketplace:cross-account
```

The harness prints the throwaway identity secrets it generates; if a run fails after signup (tokens consumed), re-run with `MARKETPLACE_STAGING_SECRET_A`/`MARKETPLACE_STAGING_SECRET_B` instead of tokens to sign back in. It passed against the live staging homeserver on 2026-08-21.

## Drops (durable modes only)

Drops (ADR 0026, phase D1 — FCFS) run only against the durable transaction service: server time is the feature, so sandbox mode gets no drops and shows the affordances as unavailable, labeled. With the app in `transaction-service` (or `locks-paykit`) mode:

- **Shopper surfaces.** The drops calendar at `/marketplace/drops` (fed by the dedicated Nexus's `GET /v0/stream/drops`; it degrades honestly to an empty state when the configured index lacks the stream) and the drop page at `/marketplace/drop/{seller}/{dropId}` — server-corrected countdown, the pre-T-0 **ready check** (session + address + per-buyer allowance staged before launch), the FCFS claim through the existing checkout path with the service's refusal copy rendered verbatim (never a fake queue), and the ended/archive states. Paid drop orders show their edition badge on the orders timeline; the "Edition N of M" line renders only from the offline-verified `pubky-drop-edition+v1` attestation.
- **Merchant surfaces.** The **Drop Studio** at `/marketplace/sell/drops`: a composer over existing listings with the two-truth publish status (record on your homeserver / registered with the service — the same split listings have), mission control with visibility-bounded polling during the window, a typed-CANCEL kill switch, and post-end release-listings returning remaining stock to open sale.

**Sandbox payment advancement on staging.** The deployed staging service runs with `SANDBOX_PAYMENTS_ENABLED=true`, so buyer-driven sandbox payment advancement works there — staging handles no real orders, and the sandbox path stands in for a real payment rail. The service-side gate defaults to `false`, and per the service README it **must stay `false` on any deployment handling real orders**: with the flag at its default the service rejects `payment.sandbox_advance` outright regardless of what any client sends (the client's own transport allowlist refuses to send it at all — a courtesy, not the boundary).

To prove the whole D1 path live — real records and `drop.sync` on the deployed stack, two real buyers racing the last unit, exactly one winner, terminal sell-out, gapless edition, offline-verified attestation inside the portable receipt on the winner's own homeserver:

```bash
npm run test:marketplace:drops
```

It needs three single-use staging signup tokens (`MARKETPLACE_STAGING_SIGNUP_TOKEN_SELLER`, `MARKETPLACE_STAGING_SIGNUP_TOKEN_BUYER_A`, `MARKETPLACE_STAGING_SIGNUP_TOKEN_BUYER_B` — one per identity) or, on re-runs, a saved-identities JSON file whose path OUTSIDE the repo is supplied at run time via `MARKETPLACE_STAGING_DROP_IDENTITIES_FILE`; the harness writes that file itself on the first successful signup and prefers it afterward so tokens are not burned. `MARKETPLACE_SERVICE_URL` and `MARKETPLACE_NEXUS_URL` override the deployed defaults. Tokens, secrets, and the identities-file path are never committed. Like the other staging proofs, it is run-on-demand, never a standing gate. It passed on 2026-08-23 — see the proof ledger in [`status.md`](status.md).

## Running a real Locks/Paykit payment (`locks-paykit` mode)

Real payments work end to end on regtest, with the wallet's protocol role exercised by the composed environment's real tooling (`paykit-companion-auth` approves the watch-only companion claim; `paykit-reader-demo` receives the private Paykit Payment Request). The real Bitkit wallet leg (companion claim, in-app Payment Request, swipe-to-pay, on-chain confirmation) was proven on regtest on 2026-08-22; production runs the same flow against mainnet Paykit — see [`status.md`](status.md).

The Paykit server the Shop talks to is a runtime choice. The default, `PUBKY_RUNTIME_PAYKIT_SERVER_API=fork`, targets the `BitcoinErrorLog/paykit-server` fork (rc55), which production runs. `upstream` targets `pubky/paykit-server` (rc11) with `pubky/locks` (rc10) and also needs `PUBKY_RUNTIME_PAYKIT_SETUP_CREATOR_PARAM=false`; the marketplace service has the matching `PAYKIT_SERVER_API`. Switch the Shop, the service and the setup URL together. See [`../environment.md`](../environment.md#marketplace-and-payments-runtime).

Three pieces must run:

1. **The composed payments environment** (Lock Server, Paykit Server, Bitcoin regtest, Fulcrum, pinned Pubky testnet). It lives in its own repo checkout (`payments-env`); `./scripts/up.sh` brings it up with Lock Server on `13000` and Paykit Server on `13001`, and its own `verify.sh` re-proves the protocol leg independently. The live test drives the seller's homeserver write through the app's own homeserver path in the SDK's testnet mode, which talks to the testnet's fixed localhost ports. Publish the testnet on those stock ports in `payments-env/.env` (`LOCKS_DHT_PORT=6881`, `LOCKS_PKARR_RELAY_PORT=15411`, `LOCKS_HTTP_RELAY_PORT=15412`, `LOCKS_HOMESERVER_HTTP_PORT=6286`, `LOCKS_HOMESERVER_PUBKY_PORT=6287`, `LOCKS_HOMESERVER_ADMIN_PORT=6288`) instead of the shifted example values, and keep the `creator-demo` port (default `18080`) clear of the service's port.
2. **The durable transaction service, with Locks verification enabled.** The three `LOCKS_*` values are all-or-nothing; the service fails closed at startup on a partial configuration and refuses `payment.register_locks` entirely when they are absent:

```bash
DATABASE_URL='postgres://marketplace:marketplace@localhost:55432/marketplace' \
LOCKS_SERVER_URL='http://localhost:13000' \
LOCKS_BUNDLE_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
LOCKS_LOOKUP_HMAC_KEY="$(openssl rand -hex 32)" \
DIGITAL_DELIVERY_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
HOMESERVER_URL='http://localhost:6286' \
NEXUS_URL='http://127.0.0.1:9' \
cargo run -p marketplace-service --bin marketplace-service
```

The service also refuses to boot without the refusal-audit settings (`REFUSAL_AUDIT_DATABASE_URL`, `REFUSAL_AUDIT_RETENTION_DATABASE_URL`, `REFUSAL_AUDIT_HMAC_ROOT_B64`, `REFUSAL_AUDIT_HMAC_KEY_EPOCH` and the three attestations); see the service README's _Run_ section. The audit logins are created by the service's migrations, so run the service once, then give them passwords with `ALTER ROLE marketplace_refusal_audit_writer_login PASSWORD '...'` and `ALTER ROLE marketplace_refusal_audit_retention PASSWORD '...'` (and `GRANT CONNECT ON DATABASE marketplace` to both) matching the URLs. `DIGITAL_DELIVERY_ENCRYPTION_KEY` is required because a Locks listing is digital and checkout refuses digital lines without it. The Nexus URL only needs to be a well-formed `http(s)` URL here: an unreachable index fails open. To use a port other than `8080` (the `creator-demo` container publishes `8080` by default), set `BIND_ADDR` and pass `MARKETPLACE_SERVICE_URL` to the test.

3. **The app in `locks-paykit` mode.** Activation is validated fail-closed: every payment-rail URL must be EXPLICITLY set or the runtime config parse throws — the mode never activates on defaulted localhost URLs:

```bash
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=locks-paykit \
PUBKY_RUNTIME_MARKETPLACE_URL=http://127.0.0.1:8080 \
PUBKY_RUNTIME_LOCKS_URL=http://localhost:13000 \
PUBKY_RUNTIME_PAYKIT_SETUP_URL=http://localhost:13001/setup \
npm run dev
```

Upstream Paykit seller setup uses the denomination-aware Locks API: `GET /creator/paykit/setup-status?asset=BTC`. Deploy Shop and the Lock Server supporting that contract (pubky/locks#75) together. The older Lock Server rejects the query parameter, while the denomination-aware server requires it; mismatched deployments make seller setup appear disconnected. This checks readiness for the Shop's BTC-priced payment requests; accepted payment methods are supplied by Paykit. Deployments using `paykitServerApi=fork` do not use this route.

What the buyer flow does (and deliberately does not do): after checkout creates an order with an `awaiting_entitlement` payment, the buyer's "Request payment in your wallet" action submits a proof bundle to the Lock Server (which signs and sends the real invoice request to Paykit Server) and registers the correlation with the transaction service via `payment.register_locks`, sourcing `expected_revision` from a fresh projection read. Registration flips the payment to the `locks` adapter — permanently refusing sandbox advancement — and **never advances the payment**: the service's worker independently verifies the Locks lifecycle and confirms exactly once. The buyer-visible status is limited to awaiting payment, confirmed, window expired, and manual review; detection and confirmation counts stay internal per the upstream contract. Status polling is bounded by the registration's payment window, abortable, and resumable after reload (the correlation — including the bearer bundle id in plaintext — is persisted in origin-scoped Dexie `commerce_locks_correlations` and wiped on sign-out/account switch; the Dexie name and the bundle id do not isolate identities). After confirmation, a digital order unlocks its content through a short-lived Locks access credential and the delivered bytes are BLAKE3-verified against the listing record before being offered.

To prove the whole path live — proof bundle, `payment.register_locks`, private Payment Request receipt, on-chain regtest payment, worker confirmation, order `paid` with a durable receipt, and a hash-verified guarded read:

```bash
# expects payments-env checked out as a sibling directory (override: PAYMENTS_ENV_DIR)
npm run test:marketplace:locks
```

This live suite uses no mocks and fails loudly when a dependency is missing. It orchestrates the environment's own tooling over `docker compose` for the seller-side setup and the wallet-simulation roles, and exercises the client's own services (`LocksGatewayService`, `MarketplaceGatewayService`, `CommerceApplication`) for every marketplace-side step. Each run creates a fresh buyer identity (an invoice binds to its reader, so exactly one Payment Request must be actionable) and writes its observed facts to `.live-out/`.

## Troubleshooting

**Marketplace missing from navigation.** Expected unless `PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE` is set to something other than `unavailable`.

**Catalog empty.** Seed it at `/marketplace/sandbox`. If that page 404s, the app is not in sandbox mode.

**`/marketplace/sandbox` 404s.** The env var is not reaching the app. Locally the server reads it when it renders each page, from the environment `npm run dev` started with, so restart `npm run dev` after setting it.

**Everything transactional errors after a restart.** The sandbox service lost its memory. Re-seed.

**Local data disappeared once after upgrading.** Expected. The marketplace adds Dexie tables, which requires a database version change, and the app recreates the database on version change (ADR 0023). Feeds and profiles re-sync from your homeserver; device-local drafts do not.
