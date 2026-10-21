# Shop Developer Onboarding

Everything a developer needs to run, test and release [Pubky Market](https://shop.pubky.app), the marketplace client
built from this repository.

## What the Shop is

A peer-to-peer marketplace on Pubky:

- **Records live with the seller.** Shops, listings, reviews and drops are signed records on the seller's own
  homeserver, indexed by a marketplace Nexus.
- **A small Rust service enforces what a browser can't:** single-winner inventory, auctions, orders and receipts.
- **Payments go straight to the seller.** Bitcoin runs over Paykit and Locks; PayPal is seller-direct. Card payments
  are paused. The Shop never holds funds.
- **Messaging is end-to-end encrypted** between the two parties: each message is an encrypted file on the sender's own
  homeserver, and it works with every sign-in ([`../chat/README.md`](../chat/README.md)).

This repository holds the Shop web client, built on the Pubky social app
([pubky/pubky-app](https://github.com/pubky/pubky-app)), together with the project documents and the tester issue
tracker. The Shop runs standalone and supports an opt-in same-origin App `/shop` wrapper around `/shop-embed`. See [the embedding guide](../launch/shop-embedding.md).

Read [`status.md`](status.md) for what is real and what is simulated, and [`FEATURES.md`](FEATURES.md) for the
feature inventory.

## Repositories

The deployment column is an early-October handover snapshot, not a verified current infrastructure inventory. Confirm current images, hosts and environment values with VV in [pubky/shop-migration](https://github.com/pubky/shop-migration).

| Repository                                                                            | What                                                                               | Work branch | Deployment snapshot                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| [pubky/pubky-marketplace](https://github.com/pubky/pubky-marketplace)                 | Shop web client (Next.js, `@synonymdev/pubky` 0.16.2), project docs, tester issues | `master`    | Vercel `pubky-marketplace-production` (shop.pubky.app) and `pubky-marketplace-staging`  |
| [pubky/pubky-marketplace-service](https://github.com/pubky/pubky-marketplace-service) | Transaction service (Rust, sqlx, Postgres)                                         | `main`      | Railway, GHCR image pinned in `.railway/railway.ts`; staging at `staging-api.pubky.app` |
| [pubky/marketplace-nexus](https://github.com/pubky/marketplace-nexus)                 | Marketplace indexer (upstream Nexus plus marketplace indexing)                     | `main`      | Railway; see its `docs/railway-deploy.md`                                               |
| [BitcoinErrorLog/paykit-server](https://github.com/BitcoinErrorLog/paykit-server)     | Paykit server (fork)                                                               | `master`    | Railway; production host `paykit-shop.pubky.app`                                        |
| [BitcoinErrorLog/pubky-app-specs](https://github.com/BitcoinErrorLog/pubky-app-specs) | Marketplace record types (specs fork)                                              | —           | Vendored into this repository as a tarball                                              |
| [pubky/pubky-shop-sdk](https://github.com/pubky/pubky-shop-sdk)                       | `@bitcoinerrorlog/pubky-shop` SDK                                                  | `main`      | npm                                                                                     |

In this repository, `master` is the default branch and the Shop release line. Releases up to `shop-v0.6.46` were cut
from `release/shop-v0.6.8` in `BitcoinErrorLog/pubky-app`; that history and its tags are part of this repository.

## Access to request on day one

- Write access to the repositories above.
- Access to the current deployment platform from VV; historical Vercel projects use team `synonymdev`.
- Sentry, for the Shop's error reports.
- Test seats for the release proof, passed out of band by the product owner. Never commit them.

## Run it locally

```bash
git clone https://github.com/pubky/pubky-marketplace.git && cd pubky-marketplace
HUSKY=0 npm ci           # HUSKY=0 keeps husky from replacing your global git hooks
npm run marketplace:dev  # terminal 1: in-memory sandbox transaction service on :3100
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=sandbox \
PUBKY_RUNTIME_MARKETPLACE_URL=http://localhost:3100 \
NEXT_PUBLIC_DB_NAME=franky-marketplace-sandbox npm run dev   # terminal 2: http://localhost:3000
```

Sign in, open `/marketplace/sandbox`, and seed the catalog. [`RUNNING.md`](RUNNING.md) covers every mode: the durable
Rust service (it needs a local Postgres using scram-sha-256 auth, which its `docker compose` provides), chat against
a local Pubky testnet, drops, and real Locks/Paykit payments.

## Test

| What                            | Command                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| Pre-push gate (required)        | `bash scripts/prepush.sh` (last line `PREPUSH OK <sha> <seconds> fast`) |
| Release gate                    | `PREPUSH_FULL=1 bash scripts/prepush.sh` (last line ends in `full`)     |
| Types and lint                  | `npm run typecheck`, `npm run lint`                                     |
| Unit tests                      | `npm run test`                                                          |
| Sandbox service tests           | `npm run test:marketplace`                                              |
| Linux visual regression         | `bash scripts/vrt-linux.sh [spec...]` (Docker; the CI merge gate)       |
| Launch-critical browser journey | `LAUNCH_E2E_MODE=synthetic bash scripts/ci-launch-e2e.sh`               |

Live suites that need a running service, a local Pubky testnet, or staging signup tokens are listed in
[`RUNNING.md`](RUNNING.md#running-the-tests). They are run on demand, not as standing gates.

## Merge

- Pull requests target the open train branch `train/shop-<date>-<am|pm>`; the train merges into
  `master` at the cut.
- CI must pass: Check Code Quality, Check NextJS Build, the five test shards, Run Tests, Merge Coverage Reports,
  `vrt-marketplace`, `vrt-core`, `launch-e2e`. No approving review is configured; agree a review rule as a team.
- Auto-merge is off, and maintainers do the merges. After pushing, wait with `gh pr checks <N> --watch`, then ask a
  maintainer to merge; they merge with `gh pr merge <N> --squash` once every check passed or skipped. Automated agents
  never merge and never push `master`.
- Regenerate Linux VRT baselines only for scenes you changed, once, in a commit of PNGs alone. Never re-pin a scene
  you did not touch. Details: [`release.md`](release.md#visual-regression-baselines).
- User-visible changes add a fragment under `changelog.d/next/`.

## Code rules

[`AGENTS.md`](../../AGENTS.md) and [`docs/README.md`](../README.md) are binding. In short:

- Layering is UI → controllers → application → services; components call hooks, not controllers.
- No `useMemo` or `useCallback` (the React Compiler memoizes).
- No barrel `index.ts` files under `src/components`.
- Errors go through the `Err.*` factories, never `new Error`.
- Telemetry carries static text only: no ids, pubkys, URLs or query values.
- Commit messages follow [`commit-message.md`](../commit-message.md).

## Release

Follow [`release.md`](release.md) for source gates, deployed grant-session verification, tags and notes. Its Vercel recipe is for the historical standalone deployment; use VV’s current deployment configuration for the embedded pair. The older `scripts/release/release-proof.mjs` still asserts Ring cookie sign-in and cannot certify this grant-only release. Production operations, the kill switch and rollback are
in [`runbook-production.md`](runbook-production.md).

## Known limits

- **A stranger's first message needs the inbox.** Chat works with every sign-in that holds the chat scopes, but a
  message from someone you have never talked to is noticed through the `pubky/inbox` service, which needs a grant
  session and a deployed inbox (`PUBKY_RUNTIME_INBOX_URL`).
  ([`../chat/README.md`](../chat/README.md)).
- **Shared sign-in requires the same origin.** App owns the grant only in the supported `/shop` + `/shop-embed` pair. A separate `shop.pubky.app` tab establishes a separate grant; this is not cross-origin SSO.
- **The old vibe consumer is removed.** Keep `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` unset. Cookie-only accounts must sign in again.
- **Commerce needs its own approval and configured backend.** Local-key users must have that same identity in a supported external signer. See [grant authentication](../launch/grant-auth-session.md) for recovery and messaging limits.

## Architecture decisions

ADRs 0019–0029 in [`docs/adr/`](../adr/) record the marketplace architecture: the transaction service, the record
specs, local-first commerce state, drops, and the former session consumer. Current sign-in and lifecycle behavior is in
[Grant authentication and App-owned sessions](../launch/grant-auth-session.md).
[`single-approval.md`](single-approval.md) and [`service-auth.md`](service-auth.md) also contain historical cookie/AuthToken contracts; do not use those as the current UI sign-in recipe.

## Who to ask

| Topic                                                         | GitHub                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Product decisions, Vercel access, test seats, backend deploys | [BitcoinErrorLog](https://github.com/BitcoinErrorLog)                                                                                   |
| Testing, issue reports, payment canaries                      | [thisispav](https://github.com/thisispav)                                                                                               |
| Bitkit testing                                                | [piotr-iohk](https://github.com/piotr-iohk)                                                                                             |
| Visual design                                                 | [aldertnl](https://github.com/aldertnl)                                                                                                 |
| pubky.app changes                                             | [secondl1ght](https://github.com/secondl1ght), [infin1t3](https://github.com/infin1t3), [talosmachina](https://github.com/talosmachina) |
| Bitkit and Paykit client issues                               | [ovitrif](https://github.com/ovitrif)                                                                                                   |
| Nexus, homeserver, Paykit server, Locks, Passport             | The maintainers of the corresponding `pubky/*` repositories                                                                             |
