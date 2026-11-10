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

| Repository                                                                            | What                                                                               | Work branch | Deployment snapshot                                                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| [pubky/pubky-marketplace](https://github.com/pubky/pubky-marketplace)                 | Shop web client (Next.js, `@synonymdev/pubky` 0.16.2), project docs, tester issues | `master`    | Deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration)                                          |
| [pubky/pubky-marketplace-service](https://github.com/pubky/pubky-marketplace-service) | Transaction service (Rust, sqlx, Postgres)                                         | `main`      | GHCR image, deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration)                              |
| [pubky/marketplace-nexus](https://github.com/pubky/marketplace-nexus)                 | Marketplace indexer (upstream Nexus plus marketplace indexing)                     | `main`      | Deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration)                                          |
| [BitcoinErrorLog/paykit-server](https://github.com/BitcoinErrorLog/paykit-server)     | Paykit server (fork)                                                               | `master`    | Deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration); production host `paykit-shop.pubky.app` |
| [BitcoinErrorLog/pubky-app-specs](https://github.com/BitcoinErrorLog/pubky-app-specs) | Marketplace record types (specs fork)                                              | —           | Vendored into this repository as a tarball                                                                                |
| [pubky/pubky-shop-sdk](https://github.com/pubky/pubky-shop-sdk)                       | `@bitcoinerrorlog/pubky-shop` SDK                                                  | `main`      | npm                                                                                                                       |

In this repository, `master` is the default branch and the Shop release line. Releases up to `shop-v0.6.46` were cut
from `release/shop-v0.6.8` in `BitcoinErrorLog/pubky-app`; that history and its tags are part of this repository.

## Access to request on day one

- Write access to the repositories above.
- Access to the deployment configuration in [pubky/shop-migration](https://github.com/pubky/shop-migration), from its maintainers.
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
| Release gate                    | `PREPUSH_FULL=1 bash scripts/prepush.sh` (adds related Linux VRT)       |
| Types and lint                  | `npm run typecheck`, `npm run lint`                                     |
| Unit tests                      | `npm run test`                                                          |
| Sandbox service tests           | `npm run test:marketplace`                                              |
| Linux visual regression         | `bash scripts/vrt-linux.sh [spec...]` (Docker; the CI merge gate)       |
| Launch-critical browser journey | `LAUNCH_E2E_MODE=synthetic bash scripts/ci-launch-e2e.sh`               |

The pre-push scheduler uses `lockf` and defaults its shared lock directory to
`/Volumes/t7/vibes-dev/.locks` (`scripts/heavy-lock.sh`). On a machine without that writable volume,
set a shared local directory before running the gate or pushing:

```bash
export HEAVY_LOCK_DIR="$HOME/.cache/pubky-marketplace/locks"
```

Use the same directory for all Market worktrees on the machine so concurrent heavy checks still share their slots.
This changes only where the existing scheduler stores its locks; it does not skip any checks.

Additional integration/live suites and their service, local-testnet or staging-token requirements are listed in
[`RUNNING.md`](RUNNING.md#running-the-tests). Run those on demand with the required environment. The separate
`chat-e2e` CI job provisions its own local stack; synthetic launch and local-stack chat checks do not replace deployed release proof.

## Merge

- Use the agreed target: the open `train/shop-<date>-<am|pm>` branch when working on a train, or `master` when no train is open or the task explicitly targets it. Train cuts follow [`release.md`](release.md#release-train).
- The current [master ruleset](https://github.com/pubky/pubky-marketplace/rules/26693412) requires an approving review, dismisses stale approvals after new commits, requires resolved review discussions and passing required checks, and uses a merge queue. Check GitHub for the current rules instead of assuming train branches have the same protection.
- Preserve Market's additional CI: unit shards and coverage, Code Quality, NextJS Build, Linux `vrt-marketplace`/`vrt-core`, and synthetic `launch-e2e`. The separate local-stack `chat-e2e` also runs on relevant PRs; running in CI does not by itself make a job a required check.
- Run `bash scripts/prepush.sh` before every push, then watch CI with `gh pr checks <N> --watch`. Maintainers normally perform merges: feature-to-train PRs are squashed; train-to-master keeps a merge commit and follows the queue. Agents do not merge or push `master` without an explicit instruction, and never bypass protection with `--admin`.
- Regenerate Linux VRT baselines only for scenes you changed, once, in a commit of PNGs alone. Never re-pin a scene you did not touch. Details: [`release.md`](release.md#visual-regression-baselines).
- User-visible changes add a fragment under `changelog.d/next/`. Follow the general [PR conventions](../commit-message.md#branches-and-pull-requests) and complete the PR template with actual verification results.

## Code rules

[`AGENTS.md`](../../AGENTS.md) and [`docs/README.md`](../README.md) are binding. In short:

- Layering is UI → controllers → application → services; components call hooks, not controllers.
- No `useMemo` or `useCallback` (the React Compiler memoizes).
- No barrel `index.ts` files under `src/components`.
- Errors go through the `Err.*` factories, never `new Error`.
- Telemetry carries static text only: no ids, pubkys, URLs or query values.
- Commit messages follow [`commit-message.md`](../commit-message.md).

## Release

Follow [`release.md`](release.md) for source gates, deployed grant-session verification, tags and notes. Deployment is through [pubky/shop-migration](https://github.com/pubky/shop-migration); use its configuration for the embedded pair. `scripts/release/release-proof.mjs` verifies grant-session sign-in (`signin_grant`, a persisted grant record and no cookie session export) and rejects cookie-session POSTs. Run it with the test seats and target configuration described in the runbook; synthetic PR checks do not replace this deployed proof. Production operations, the kill switch and rollback are in shop-migration.

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

| Topic                                                | GitHub                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Product decisions, test seats, backend pull requests | [BitcoinErrorLog](https://github.com/BitcoinErrorLog)                                                                                   |
| Testing, issue reports, payment canaries             | [thisispav](https://github.com/thisispav)                                                                                               |
| Bitkit testing                                       | [piotr-iohk](https://github.com/piotr-iohk)                                                                                             |
| Visual design                                        | [aldertnl](https://github.com/aldertnl)                                                                                                 |
| pubky.app changes                                    | [secondl1ght](https://github.com/secondl1ght), [infin1t3](https://github.com/infin1t3), [talosmachina](https://github.com/talosmachina) |
| Bitkit and Paykit client issues                      | [ovitrif](https://github.com/ovitrif)                                                                                                   |
| Nexus, homeserver, Paykit server, Locks, Passport    | The maintainers of the corresponding `pubky/*` repositories                                                                             |
