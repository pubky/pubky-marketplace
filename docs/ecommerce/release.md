# Shop Release Runbook

How a Shop release goes from merged pull requests to a proven deployment. Team deployments (staging, then production)
run on Synonym's GCP and are deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration); the
launched Shop is served at <https://pubky.app/shop>, and `shop.pubky.app` redirects there. This repository carries no
host-specific deployment instructions: deploying, rolling back and operating a host live in shop-migration, and
personal development hosting is out of scope. Local setup is in [`onboarding.md`](onboarding.md) and
[`RUNNING.md`](RUNNING.md).

"Live" means the deployed grant sign-in, shared-session lifecycle and service-approval journeys have passed against the release revisions. A green build or synthetic network fixture is not that proof; the [signed-in production proof](#signed-in-production-proof) is.

## Branches and targets

The GCP deployment takes the Shop as a Docker image built from a `v*` tag by
[`release-docker.yml`](../../.github/workflows/release-docker.yml), which shop-migration then pins; agree the tag with
the shop-migration maintainers there, because this runbook tags `shop-vX.Y.Z`. The
[embedding guide](../launch/shop-embedding.md) specifies the embedded frontend requirements.

| Item                        | Value                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release branch              | `master`, the repository default and the Shop line; every release ships from it. Releases up to `shop-v0.6.46` shipped from `release/shop-v0.6.8` in `BitcoinErrorLog/pubky-app`, whose history is part of this repository. |
| Train branches              | `train/shop-<YYYY-MM-DD>-<am\|pm>`, cut from the release branch head                                                                                                                                                        |
| Tags                        | `shop-vX.Y.Z` on the deployed commit, with a GitHub release                                                                                                                                                                 |
| Team staging and production | Synonym GCP, deployed through [pubky/shop-migration](https://github.com/pubky/shop-migration). Production is <https://pubky.app/shop> (`shop.pubky.app` redirects there)                                                    |
| Backend services            | Separate repositories, deployed separately: `pubky-marketplace-service`, `pubky/marketplace-nexus`, the `paykit-server` fork (until the upstream Paykit switch). See their READMEs.                                         |
| Unrelated branches          | `pubchi/v1` is a different product. Do not base Shop work on it.                                                                                                                                                            |

## Tools

- Node from [`.nvmrc`](../../.nvmrc), `npm`, the GitHub CLI (`gh`), and Docker (the Linux VRT gate runs in a pinned
  Playwright container).
- Playwright's Chromium for the production proof: `npx playwright install chromium`.
- At least 30 GiB of free disk before a VRT run or a release build; the VRT container and its screenshots need that
  headroom.

Install dependencies with `HUSKY=0 npm ci`. Husky's `prepare` script otherwise sets a repository-local
`core.hooksPath`, which silently replaces any global git hooks you rely on. Never `npm install` a package to fix a
missing dependency: fix `package-lock.json` in a pull request, then `HUSKY=0 npm ci` again.

## Grant SDK and embedded release requirements

App and Shop share the SDK's `pubky-auth` database on the embedded origin. For an SDK upgrade, bump `@synonymdev/pubky` in **both repositories**, update both lockfiles, and verify both builds resolve the same reviewed SDK version. This branch pins 0.16.2. Do not independently upgrade one consumer or assume the pending-key persistence adapter survives a schema change.

Before shipping an SDK bump, rerun the real SDK storage/error and ownership contracts plus auth lifecycle tests in both checkouts:

```bash
# Shop checkout
npm test -- src/core/services/homeserver src/core/controllers/auth src/core/stores/auth \
  src/libs/shop-session src/hooks/useShopHostSession src/providers/ShopHostSessionProvider

# App checkout (the paired App PR)
npm test -- src/core/services/homeserver src/core/controllers/auth src/core/services/local/auth \
  src/core/services/shop-embed src/libs/shop-embed src/hooks/useShopEmbed src/components/organisms/ShopEmbed
```

Then verify the paired production builds in a browser: restore/reload, two tabs, logout with and without the Shop iframe mounted, same-account return, account switch, failed storage/BFF cleanup and recovery, and preservation of unrelated SDK records. Confirm real signer approvals and commerce against the configured staging services before promoting the paired deployment. Keep exact revision and fixture/live provenance with each result.

Follow [Shop embedding](../launch/shop-embedding.md) for the fixed `/shop-embed` build path, runtime environment, BFF schema/keys and coordinated deployment. The [grant session guide](../launch/grant-auth-session.md) records migration and compatibility limits, including the parallel Inbox/chat work.

## Day-to-day merges

1. Branch from the current train branch (or from the release branch if no train is open) and open the pull request
   against the train.
2. Before every push run `bash scripts/prepush.sh`. Fast mode (the default) runs `prettier --check` and `eslint` on
   files changed since the merge base, `npm run typecheck`, and `npx vitest related --run` on those files. The last
   line on success is `PREPUSH OK <sha> <seconds> fast`. A tree that already passed is not re-run.
3. Auto-merge is off in this repository, and maintainers do the merges. After pushing, wait for CI with
   `gh pr checks <N> --watch` and ask a maintainer to merge. The maintainer merges with `gh pr merge <N> --squash`
   (train-to-release pull requests keep a merge commit: `--merge`), only when every check passed or skipped, and never
   with `--admin`. Automated agents open pull requests and comment; they never merge and never push `master`.
4. Required checks on `master`: Check Code Quality, Check NextJS Build, Run Shard Tests (1) to (5), Run Tests, Merge
   Coverage Reports, `vrt-marketplace`, `vrt-core`, `launch-e2e`. A pull request is required; no approving review is
   configured, so the team sets its own review rule. Force pushes and branch deletion are blocked. `launch-e2e` runs on
   pull requests into `master` and `release/shop-*` in explicit synthetic mode: real SDK grants and browser
   persistence, with isolated PKARR, homeserver, BFF and marketplace fixtures. It needs no seller secret and also
   runs on forks. Optional live mode requires `LAUNCH_E2E_SELLER_SECRET_HEX` and a grant-enabled backend; synthetic
   success does not replace staging approval/payment QA. Pull requests that change only `docs/`, `payments-env/` or `*.md` files skip the build, the unit suite
   and VRT; their checks still report.

**Flake outside the diff.** If the only failures are test files the diff does not touch, rerun those files alone
twice. If both reruns pass and the rest of the gate passed, the push may skip the hook (`--no-verify`) with the gate
log and both reruns pasted in the pull request body. A failure in a touched file, typecheck, lint or VRT is never
skipped.

## Visual regression baselines

Linux baselines (`*-linux.png`) rendered in `mcr.microsoft.com/playwright:v1.60.0-noble` are the only merge gate.
Darwin PNGs are not required and are not regenerated.

- Run the gate locally with `bash scripts/vrt-linux.sh [spec...]` (no argument runs the whole Linux suite).
- Before any VRT run, the installed Playwright must equal the lockfile's:
  `node -p 'require("./node_modules/playwright/package.json").version'` against
  `packages["node_modules/playwright"].version` in `package-lock.json`. A mismatch renders every scene differently;
  discard any PNG produced while they differed.
- A feature pull request regenerates Linux baselines only for scenes it intentionally changed, once, after its last
  UI change, in one commit that contains only PNGs. Locally:
  `VRT_LINUX_UPDATE=1 bash scripts/vrt-linux.sh <spec...>` then `bash scripts/vrt-revert-outside.sh <spec...>`.
  In CI: run the **VRT Update Baselines** workflow on the pull request branch with the spec paths as `files`.
- `--update` rewrites every scene in the named files, and a path argument does not isolate it. Always run
  `vrt-revert-outside.sh`, then check `git status --short -- '**/__screenshots__/**'` and keep only the intended set.
- Never re-pin a scene the pull request did not touch. A failure on an untouched scene goes to the train owner with
  the scene name and the diff ratio.
- Calibrate every regeneration: open at least two new PNGs and confirm they show the intended state, confirm the kept
  files are distinct (`md5`), and treat a tiny full-viewport PNG as a blank frame.
- A change to `src/test/mocks/**` or `src/test-utils/vrt.tsx` changes every scene: run the full suite.

## Release train

At most one or two Shop releases a day. An extra cut runs only for a production P0 or P1 fix.

1. **Find the live release.** `gh release list -R pubky/pubky-marketplace --limit 1` gives the last `shop-vX.Y.Z`
   (`-R BitcoinErrorLog/pubky-app` for `shop-v0.6.46` and earlier).
2. **Close the train.** Open one pull request from `train/shop-<date>-<am|pm>` into `master`. A pull
   request that missed the cut waits for the next train. Nothing merges to the release branch outside a train.
3. **Baselines once.** If any merged change moved a scene, regenerate Linux baselines once on the train head (rules
   above), then run the full marketplace VRT suite once.
4. **Proof on the release head.** On the merged release branch commit, in a clean checkout:

   ```bash
   PREPUSH_FULL=1 bash scripts/prepush.sh               # last line must end in "full"
   npm run typecheck && npm run lint
   npm run test                                          # the whole unit suite; keep the summary lines
   bash scripts/vrt-linux.sh src/test/vrt/marketplace/   # the whole marketplace VRT suite
   npx prettier --check $(git diff --name-only --diff-filter=d shop-v<prev>..HEAD -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.json' '*.md' '*.css')
   git status --short | wc -l                            # 0
   ```

   A proof is reusable only while no file has changed since it ran. A merge commit is a new source state.

5. **Check deployment config parity** before every deploy. Public runtime values are inlined into each deployment's
   HTML, so read them from what the target serves instead of from its environment (which holds secrets):

   ```bash
   curl -fsS <origin>/marketplace \
     | grep -oE '"(marketplaceNexusUrl|marketplaceUrl|locksUrl|paykitSetupUrl|homeserverUrl|commerceAdapterMode)":"[^"]*"'
   ```

   Repeat for every origin the release will reach. `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID`
   must not be set in any deployment's environment: they no longer enable cookie-based sign-in, and obsolete
   configuration can be mistaken for the supported same-origin integration. Runtime values are read from the
   process environment and memoized; restart after changing them. Build-time `NEXT_PUBLIC_*` values still require a
   rebuild. See [the non-Docker startup example](../launch/shop-embedding.md#running-with-next-start-without-docker).

6. **Deploy** (next section), **prove** (the section after), then **tag and publish notes**.

## Deploy

Deployment is done through [pubky/shop-migration](https://github.com/pubky/shop-migration): GCP staging first, then
production. Agree the release tag and the pinned image with the shop-migration maintainers there; this repository does
not deploy anything itself.

`GET /api/build` (under the base path when the Shop is mounted on one) returns `{"commit":"<12-char SHA>"}` and nothing
else: no version, build time or host. It reads `GIT_COMMIT`, then `VERCEL_GIT_COMMIT_SHA` where a platform sets it, and
reports `unknown` for anything that is not a hex SHA. Docker images take the `GIT_COMMIT` build arg. A build whose
`GIT_COMMIT` is set also makes that commit its Sentry release; the build creates the release with its commits and
records the deploy ([Sentry → Releases](../sentry.md#releases)). Use it to confirm which commit a host runs; the Shop has
no version endpoint or build meta tag. For the marketplace service, the digest of the running image is the record; see
[Backend releases](#backend-releases).

The proof scripts check that the origin serves the deployment under proof, and one of two expectations is required:

- `EXPECTED_COMMIT`: the git commit (7 to 40 hex characters) that `GET /api/build` must report. It works on any host,
  GCP included, once the build reports its commit (`GIT_COMMIT` build arg). The build route lives under the mount
  path, so for the embedded build set `PROOF_ORIGIN=https://<app origin>/shop-embed` and the scripts read
  `/shop-embed/api/build`. The build reports a short SHA; a full SHA or any prefix of at least 7 characters matches it.
- `EXPECTED_DPL`: a Vercel `dpl_…` deployment id that the served page must name. For Vercel instances.

When both are set the origin must satisfy both. With neither, the scripts refuse to run.

After a deploy, `PROOF_ORIGIN=<origin> EXPECTED_COMMIT=<sha> node scripts/release/served-checks.mjs` checks what the site
serves with plain HTTP: the deployment identity, that the Locks SDK wasm is named in a chunk and served as `application/wasm`
byte-identical to the pinned SDK, the USDT flag in the served config, and the service's `/health`. The wasm sits in a lazy
chunk, so the script reads webpack's chunk map (Next.js writes it in more than one shape) and crawls every chunk. It has
no build-meta or version check; `/api/build` is read only when `EXPECTED_COMMIT` is set.

The USDT checks expect USDT off unless `SERVED_CHECKS_USDT=on`; then the served config must have `usdtPaymentsEnabled`
true and `/health` must list `usdt_payments`. Set it to the target's real state: John Prod has had USDT on since
2026-10-16, so its target file (`proof/targets/production.env` in pubky-dev-hosting) sets `SERVED_CHECKS_USDT=on`.
Without it, the two USDT checks fail on John Prod by design.

## Signed-in production proof

`scripts/release/release-proof.mjs` drives the deployed Shop in headless Chromium with two test seats and the same
`approveAuthRequest` call Pubky Ring and Bitkit's Paykit make. It proves the grant-session release: both signers sign in
with a `signin_grant`, sign-in mints the marketplace session from the grant where grant sessions are on, sign-out ends
the grant session, and checkout, Activity and the seller surfaces work for a signed-in seat. Nothing is paid and no
order command is sent. Afterwards it revokes every marketplace session either seat gained and deletes any storefront
(`shop.json`) the run caused, and verifies both.

`scripts/release/production-paypal-fixture.mjs` can wrap it: it gives the seller seat a temporary PayPal rail and one
`TEST, do not buy <run>` listing, runs the proof against that listing, then always tears everything down and verifies
the teardown. Without the wrapper, step 4 looks for an existing listing whose seller takes PayPal (test titles first,
never either seat's own).

### Inputs

All inputs are environment variables. Seat files, passphrases and the PayPal address never enter the repository, a
command line, or the evidence folder.

| Variable                                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROOF_SELLER_RECOVERY_FILE`, `PROOF_BUYER_RECOVERY_FILE` | Encrypted `pubky.org/recovery` backups of the two production test seats                                                                                                                                                                                                                                                                                                                         |
| `PROOF_RECOVERY_PASSPHRASE`                               | Passphrase for those backups                                                                                                                                                                                                                                                                                                                                                                    |
| `PROOF_SEAT_SECRET_HEX`, `PROOF_BUYER_SECRET_HEX`         | Alternative to the files: 32-byte seat secrets as hex (used for staging-homeserver seats)                                                                                                                                                                                                                                                                                                       |
| `PROOF_SELLER_PREFIX`, `PROOF_BUYER_PREFIX`               | Optional. The run stops unless each seat's pubky starts with this, which catches a swapped seat                                                                                                                                                                                                                                                                                                 |
| `PAYPAL_TEST_EMAIL`                                       | PayPal address for the temporary seller rail. Never logged or written                                                                                                                                                                                                                                                                                                                           |
| `PROOF_EVIDENCE`                                          | Evidence folder for this release, outside the repository (the scripts refuse a path inside it)                                                                                                                                                                                                                                                                                                  |
| `EXPECTED_COMMIT`, `EXPECTED_DPL`                         | One is required. `EXPECTED_COMMIT`: the commit `GET /api/build` must report (a full SHA or a prefix of at least 7 characters). `EXPECTED_DPL`: the Vercel `dpl_…` id now aliased to the origin. The proof fails if the origin serves anything else; with both set, both must match                                                                                                              |
| `PROOF_CLIENT_ID`                                         | Optional. The grant client id the Shop's QRs must carry (`cid=`), the Shop's `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID`. Default `shop.pubky.app`                                                                                                                                                                                                                                                     |
| `PROOF_GS1`                                               | `1` where grant sessions are on (`MARKETPLACE_GRANT_SESSION_ENABLED` on the service, `PUBKY_RUNTIME_MARKETPLACE_GRANT_SESSION_ENABLED` on the Shop): step 1 also checks that sign-in minted the marketplace session from the grant, one challenge and one mint, with no further approval                                                                                                        |
| `PROOF_STEPS`                                             | Optional comma-separated subset, e.g. `1,2,9`. Step 0 and cleanup always run; `1` runs the Ring journey with steps 5 and 6. Step 11 runs only when named                                                                                                                                                                                                                                        |
| `PROOF_PAYPAL_LISTING_URL`, `PROOF_BITCOIN_LISTING_URL`   | Optional listing paths (`/marketplace/listing/<seller>/<id>`) for steps 4 and 9. The PayPal fixture sets the first; without them the proof picks test listings from Nexus                                                                                                                                                                                                                       |
| `PROOF_ORIGIN`, `PROOF_SERVICE`, `PROOF_NEXUS`            | Required: the target. There are no defaults, so a proof can never reach a host the operator did not name. When the Shop is served under a mount path, `PROOF_ORIGIN` carries it (`https://pubky.app/shop`, or `https://pubky.app/shop-embed` when the App owns `/shop` and frames the build, because the proof drives the build itself); every route the scripts open is joined under that path |
| `PROOF_RELAY`                                             | Optional. Default `https://httprelay.pubky.app/inbox`                                                                                                                                                                                                                                                                                                                                           |

The production seats belong to the product owner, who passes seat backups, the passphrase and the PayPal address out
of band. The seller seat owns the long-lived "Cutover test — do not buy" listings and must not buy its own listing;
the buyer seat runs checkout.

The capabilities the proof expects in the Ring QR are read from `CAPABILITIES` in `src/config/app.ts` of the checkout
you run it from, so run it from the release commit that was deployed (or set `PROOF_CAPABILITIES`).

### Run

Start every proof in a new shell with no `PROOF_*` variables left over from another target (`unset` them), and name
the target explicitly:

```bash
export PROOF_ORIGIN=<origin of the Shop under proof>
export PROOF_SERVICE=<marketplace service URL>
export PROOF_NEXUS=<marketplace Nexus URL>
export PROOF_SELLER_RECOVERY_FILE=/secure/path/seller.pkarr
export PROOF_BUYER_RECOVERY_FILE=/secure/path/buyer.pkarr
read -rs PROOF_RECOVERY_PASSPHRASE && export PROOF_RECOVERY_PASSPHRASE
read -rs PAYPAL_TEST_EMAIL && export PAYPAL_TEST_EMAIL
export PROOF_EVIDENCE=$HOME/shop-evidence/shop-vX.Y.Z/live-proof
export PROOF_GS1=1
mkdir -p "$PROOF_EVIDENCE"
EXPECTED_COMMIT=<sha> node scripts/release/production-paypal-fixture.mjs proof -- \
  node scripts/release/release-proof.mjs | tee "$PROOF_EVIDENCE/run.log"
```

Without the PayPal fixture, run `EXPECTED_COMMIT=<sha> node scripts/release/release-proof.mjs` directly; step 4
then needs an existing PayPal-ready test listing on Nexus.

The proof passes when `release-proof.mjs` prints `RESULT PASS n/n` (and, with the wrapper, the fixture prints
`PAYPAL_FIXTURE proof OK`). Record `n/n` in the release notes.

### What it checks

Step 3 is unused; step ids are stable across releases.

| Step    | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | The origin serves the expected deployment: `EXPECTED_COMMIT` equals the commit at `/api/build` and/or `EXPECTED_DPL` is named by the page                                                                                                                                                                                                                                                                                                                                                    |
| 1       | Ring and Bitkit QRs are both live on `/sign-in`; the Ring QR is a `signin_grant` for the Shop's capabilities and `PROOF_CLIENT_ID` and is not in the DOM; one approval gives one grant `POST` 2xx and no cookie homeserver `POST /session` or marketplace `POST /v1/auth/sessions`; the seat is signed in with a grant record and no cookie export; both QRs are gone. With `PROOF_GS1=1`, sign-in also minted the marketplace session from the grant (one challenge and one mint, both 2xx) |
| 2       | The Bitkit QR is a `signin_grant` for the Shop's capabilities and client id; approval signs in with a grant record; reload restores it; sign-out from Settings clears it and holds across a reload                                                                                                                                                                                                                                                                                           |
| 4       | The buyer seat (Ring) reaches checkout on a PayPal listing; `payment-config` loads; PayPal is offered, selectable, and its Pay control renders (never clicked); no "no payment method" copy; no USDT at checkout; nothing is paid and no order command is sent; the cart is emptied; sign-out ends the grant session (`DELETE` 2xx)                                                                                                                                                          |
| 5       | The seat's marketplace session is approved where the Shop still asks ("Authorize" or "Enable selling" in Settings); Activity is in the marketplace nav, has no unrecognized events, lists order rows, and a row opens its order card on the Orders page. If the seller's rows only point at orders its Orders page hides, the buyer seat is used                                                                                                                                             |
| 6       | Sign-out of the Ring session from Settings clears the Shop state, ends the grant session (`DELETE /auth/grant/session` 2xx), and holds across a reload                                                                                                                                                                                                                                                                                                                                       |
| 7       | Runs when step 4 found a listing. A Bitkit-grant buyer sees a purchase control; "Approve to buy" opens a grant-link approval QR that is never approved; Settings is reachable from the shared navigation at desktop and mobile width; the seller's Bitcoin availability is recorded                                                                                                                                                                                                          |
| 8       | The seller seat opens cart, checkout, orders, My shop and storefront at desktop and mobile width with a heading and no error page, sending no command                                                                                                                                                                                                                                                                                                                                        |
| 9       | The buyer seat adds a Bitcoin test listing, completes the "Enable purchases" approval when the Shop asks for it, and reaches checkout: Bitcoin is offered, with no Bitkit 2.6 or "Couldn't verify your Bitcoin wallet" notice; nothing is paid; the cart is emptied. When the fixture seller is not Paykit-ready (`bitcoin_available` false) the offer is reported `KNOWN` instead                                                                                                           |
| 10      | The seller's payment settings and My shop show no USDT, and no request during the run mentions USDT (flag off)                                                                                                                                                                                                                                                                                                                                                                               |
| 11      | Only with `PROOF_STEPS=11`: the service `/health` lists `woocommerce` under `connectors.providers`, the seller sees the WooCommerce and Shopify store types and the WooCommerce connect form, and nothing is written to `/v1/connectors`                                                                                                                                                                                                                                                     |
| cleanup | Every marketplace session either seat gained during the run is revoked, the audit bearer last, and none remain. A storefront (`shop.json`) a seat did not have before the run is deleted and verified gone from the homeserver and Nexus; one that existed before is kept, and an unknown "before" state fails                                                                                                                                                                               |

The number of checks depends on the steps run and on which fallbacks fire, so the result is reported as `n/n`. Rows
reported as `KNOWN` are informational defects outside the release and never gate it. Steps 9 and 10 expect USDT off;
on a target with USDT on, run the other steps (`PROOF_STEPS`).

### Reading the result

- `proof-log.txt`: one PASS or FAIL line per check.
- `results.json`: `steps`, `sessionAudit`, `storefrontCleanup`, `knownDefects`, network tags and console errors.
  Every `sessionAudit[].activeFromRunAfter` must be empty and every `storefrontCleanup[].ok` true.
- Screenshots `01`–`20`, one set per step that ran, plus a `*-journey-error.png` for any journey that stopped early.
- Evidence carries 8-character pubky prefixes only. Auth URLs, session exports and bearers are never printed.

The fixture changes the seller seat's PayPal rail only for the run. Setup records the rail's current value in
`paypal-fixture-state.json` (mode 600) before changing it, and teardown restores exactly that value and reads it back.
When the prior value is the test address itself, only a marker is stored, so the address never reaches disk. Without
a state file, `teardown` and `verify` change and check nothing. Setup also records whether the seller had a storefront
(`shop.json`) before it published the listing; teardown deletes one the run caused and verifies it gone from the
homeserver and Nexus, and keeps one that existed before. This step needs no browser, so it also runs when the rest of teardown failed. A
state file written by an earlier version of the script has no record of the storefront before the run, so its
storefront check always fails: confirm on the homeserver and in Nexus that the seller's `shop.json` predates the run
(or delete it if the run created it), then remove the state file by hand.

If the run fails or is interrupted, `paypal-fixture-state.json` stays in the evidence folder. Retry the cleanup with
`node scripts/release/production-paypal-fixture.mjs teardown` (same environment, including `PAYPAL_TEST_EMAIL`) until
it prints `PAYPAL_FIXTURE teardown OK`; the state file is then deleted. Do not add checks that pay or create orders.

**Never leave a test listing behind.** Any run that creates a listing on production or staging (both feed the same
marketplace Nexus) keeps the seat key it published with until cleanup is done, deletes the listing before it ends,
including on failure or interrupt, and verifies it is gone: Nexus listing detail 404, service projection 404 or zero
stock, no homeserver record. A throwaway seat's secret is kept in a mode-600 file outside the repository until that
verification passes, never only in process memory. A listing that could not be deleted is reported by id in the
release notes and removed before the next release.

### Staging

The staging Shop signs out accounts that live on the production homeserver, so a staging run needs seats created on
`homeserver.staging.pubky.app` (signup tokens come from the staging homeserver admin; ask the team), passed as
`PROOF_SEAT_SECRET_HEX` and `PROOF_BUYER_SECRET_HEX`, with `PROOF_ORIGIN`, `PROOF_SERVICE` and `PROOF_NEXUS` pointing at the GCP staging stack
(listing discovery then reads the staging Nexus). Step 4 needs a
"do not buy" listing whose seller has a PayPal sandbox rail: pass it as `PROOF_PAYPAL_LISTING_URL`, or step 4 fails
when discovery finds none. Production is the release gate.

### Paid digital delivery proof (opt-in, spends real money)

`scripts/release/production-digital-fixture.mjs` proves digital delivery with real paid Bitcoin orders on the same two
test seats: one `SMOKE FIXTURE, do not buy <run> <kind>` listing per delivery kind (file, link, text, "I'll email it", "I'll
send it in messages"), a buyer checkout paid in Bitcoin, the delivery checks on both sides, then teardown and
verification. It is not part of the release gate. It refuses to start without `PROOF_DIGITAL_GO=GO-<UTC date>`, which
the product owner authorizes per run, and it needs both `PROOF_*_PREFIX` seat guards and `EXPECTED_COMMIT` or `EXPECTED_DPL`.

Two guards are enforced in code. The script has no default target: every mode but `plan` refuses unless
`PROOF_ORIGIN`, `PROOF_SERVICE` and `PROOF_NEXUS` are set, and then refuses unless all three are the staging stack named
in `PROOF_STAGING_ORIGINS`, `PROOF_STAGING_SERVICES` and `PROOF_STAGING_NEXUS` (comma lists of URLs). With those lists
unset every target counts as production, and `PROOF_ALLOW_PRODUCTION=1` is the explicit, deliberate way to run against
production. Every mode that publishes or spends first checks that the origin serves the expected deployment (`EXPECTED_COMMIT` and/or `EXPECTED_DPL`), including `publish`
and `await-buyer`. `plan` prints which side of that line the environment is on.

The email kind types and shows the tester mailbox, so its screenshots are not saved unless `PROOF_DIGITAL_EMAIL_SCREENSHOTS=1`.
When a mailbox is configured, every saved screenshot has text containing it and any field holding it masked.

```bash
# touches nothing: prints the plan and what the environment still lacks
PROOF_EVIDENCE=$HOME/shop-evidence/digital node scripts/release/production-digital-fixture.mjs plan
```

What it automates, and what stays with a person:

| Step                                                                                                                  | Who                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Publish the listing, set the delivery, check out, choose Bitcoin, click Pay                                           | the script (seller and buyer seats)                                                                           |
| Pay the Bitkit Payment Request                                                                                        | an operator: the buyer wallet is a real Bitkit holding real funds, and the seller must be one of its contacts |
| File: two downloads whose SHA-256 equals the fixture; link and text: the revealed value equals the one set            | the script                                                                                                    |
| Seller evidence line after the buyer's access                                                                         | the script                                                                                                    |
| Email: the mailbox of a tester (`PROOF_DIGITAL_BUYER_EMAIL`) receives a real email from the seller, then Mark emailed | an operator sends the email; the script marks it and checks "Emailed to"                                      |
| Messages: the seller sends the delivery in chat, then Mark delivered                                                  | an operator (chat needs Ring today); the script marks it and checks the buyer line                            |
| Delete the listings and their ciphertext, revoke the run's sessions, verify                                           | the script; paid orders cannot be deleted and stay as evidence                                                |

Price defaults to $2.00 so the Bitcoin quote clears the service's 1,000-satoshi floor with a margin
(`PROOF_DIGITAL_PRICE_USD`, 1.00 to 25.00). The payment wait stops before the 30-minute Bitcoin hold
(`PROOF_DIGITAL_PAY_TIMEOUT_MIN`, default 25). A run that stops early leaves `digital-fixture-state.json` in the
evidence folder; clean up with `... production-digital-fixture.mjs teardown` until it prints `DIGITAL_FIXTURE
teardown OK`. The selectors come from the Shop source at the commit the script was written against; the first run
should be a staging rehearsal with staging-homeserver seats and a regtest wallet.

#### Used by the service hold-smoke (`HOLD_SMOKE_DIGITAL_FIXTURE_CMD`)

The service's `scripts/release/hold-smoke.py` needs real digital listings on a dedicated fixture seller. It publishes
them before the run and removes them afterwards, so no smoke listing stays live in the Nexus index. It does not call
this script directly: it runs the command in `HOLD_SMOKE_DIGITAL_FIXTURE_CMD` (split like a shell line) with one
argument, and puts the kinds in `HOLD_SMOKE_DIGITAL_FIXTURE_KINDS` (comma separated, same names as
`PROOF_DIGITAL_KINDS`).

| Argument   | What the wrapper must run                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `publish`  | `production-digital-fixture.mjs prepare`, then `production-digital-fixture.mjs publish`, both with `PROOF_EXTERNAL_BUYER=1` |
| `teardown` | `production-digital-fixture.mjs teardown`                                                                                   |

The wrapper is yours to write and keep outside the repository, because it carries the environment: the fixture seller's
seat (see `seats.mjs`), `PROOF_SELLER_PREFIX`, `EXPECTED_COMMIT` or `EXPECTED_DPL`, the day's `PROOF_DIGITAL_GO`, `PROOF_DIGITAL_KINDS`
set from `HOLD_SMOKE_DIGITAL_FIXTURE_KINDS`, `PROOF_ORIGIN`, `PROOF_SERVICE`, `PROOF_NEXUS` and `PROOF_RELAY` pointing
at the staging stack, and a `PROOF_EVIDENCE` folder that is emptied before each `publish`. It must exit non-zero when a
step fails: hold-smoke then runs `teardown` and a sweep, and stops if the seller still has any listing.

Listings made this way are titled `SMOKE FIXTURE, do not buy <run> <kind>` and carry a description that says they are
a staging smoke fixture. The script itself refuses a non-staging target unless `PROOF_ALLOW_PRODUCTION=1`: never set that in the hold-smoke wrapper.

## Tag and release notes

There is no `CHANGELOG.md`. Each user-visible change adds a fragment `changelog.d/next/<issue>.<kind>.md`. Fragments
are not consumed: a later release may extend a fragment for the same issue. The notes for a release are the fragments
added or changed since the previous tag:

```bash
git diff --name-only shop-v<prev>..HEAD -- changelog.d/next
git tag shop-vX.Y.Z <deployed-sha>
git push origin shop-vX.Y.Z
gh release create shop-vX.Y.Z -R pubky/pubky-marketplace --title "Shop vX.Y.Z" --notes-file <evidence-folder>/notes.md
```

The notes body is also kept in the repository as `docs/ecommerce/release-notes/shop-vX.Y.Z.md` (see `shop-v0.6.50.md` and `shop-v0.6.51.md`). The GitHub release is the record; the file is its committed copy.

The notes carry the version, date, exact commit, deployment id (where the host issues one) and URL, one line per user-visible change, the
backend deploys the release depends on (for example `marketplace-service <sha>`), known limitations, the proof result
(`RESULT PASS n/n`), and a tester notice:

- `Tester notice: log out and back in once.` when the release bumped the local database version
  (`git diff shop-v<prev>..HEAD -- src/core/database/franky/franky.ts`, or any `Dexie.version`, `declaredVersion` or
  `DB_VERSION` change).
- `Tester notice: reload is enough.` otherwise.

## Backend releases

The marketplace service, the Nexus fork and the Paykit server release from their own repositories: each builds and
publishes its container image, and the team deploys the pinned image through
[pubky/shop-migration](https://github.com/pubky/shop-migration). See each repository's README.
