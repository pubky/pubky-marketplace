# Shop v0.6.51

**Date:** 2026-10-11 (WEST)
**Commit:** `fb85c3313cf262273d65f11ea51e5ac820dd560d` (`master`, after #168)
**Deployment:** `dpl_GfpPbfm2kNpyKHtzXz8VAdGzwtiw` (alias https://shop.pubky.app)
**Previous production (rollback target):** `dpl_2nVKdkooECaSxnKsCbpEzCyaLenr` (v0.6.50). marketplace-service unchanged (`7cb803d7`, image `sha256:c62c8285…`).

Range: `shop-v0.6.50..master`. Pull requests: #147, #164, #165, #166, and #168 (formatting of one CI workflow).

## Under the hood

- The Shop's browser storage moves into its own namespace, so it can share an origin with pubky.app. The database `franky` becomes `shop-franky`, and the saved settings keys (`auth-store`, `settings-storage`, …) gain a `shop-` prefix. Existing data moves once, on first load; nothing is deleted until the copy is verified. Your session moves with it, so you stay signed in. (#147)
- The Shop can run mounted under a path on another origin (for example `https://pubky.app/shop`) and inside an iframe there. This is off by default: with no settings, framing is still denied everywhere (`frame-ancestors 'none'`). When embedded, the Shop hides its own header, footer and floating button, registers no service worker, and the PayPal checkout hand-off leaves the frame through the top window. See [`shop-embedding.md`](https://github.com/pubky/pubky-marketplace/blob/shop-v0.6.51/docs/launch/shop-embedding.md). (#147)

## Behind a flag, off, and invisible

- **USDT (#164, #165, #166).** Still off: `PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED` is unset.
  - The Shop now knows the service's `refund_destination_confirmed` notification ("The buyer confirmed a USDT refund address"). When marketplace-service S6 is deployed, a seller won't see an "unrecognized event" banner. This release must be live before S6. (#164)
  - Seller USDT readiness is read from the seller's own payment config. (#165)
  - USDT is no longer offered at checkout after the service refuses it. (#166)

## Operator actions

- **Shop config: none.** New optional settings, all left unset: `NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_ASSET_PREFIX` (build), and `PUBKY_RUNTIME_FRAME_ANCESTORS`, `PUBKY_RUNTIME_EMBEDDED` and `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY` (runtime). `NEXT_PUBLIC_DB_NAME` now defaults to `shop-franky`; don't set it to `franky`.
- **Build:** `--build-env SHOP_VERSION=shop-v0.6.51 --build-env GIT_SHA=fb85c3313cf262273d65f11ea51e5ac820dd560d`. Docker images: the `release-docker.yml` defaults now include `NEXT_PUBLIC_DB_NAME=shop-franky`.
- **marketplace-service:** no change.

## Known limitations

- Pubky Ring 2.0 crashes on launch on iOS 27 (2.0.1 pending). On Android, updating to 2.0 needs a restore from backup. (#126)
- Bitcoin payments and seller setup for Bitkit 2.6 wait for the Shop's move to upstream Paykit and Locks. (#121)
- USDT is not available to anyone in this release.

## Verification

- `master` CI on `fb85c3313`: Build, Code Quality, Tests and Visual Regression Tests all passed.
- Release gate: full prepush, typecheck, lint, the unit suite (1,114 files, 17,640 tests) and the full marketplace Linux VRT (54 files, 526 tests in Chromium and Firefox) passed on `d2e7f12aa`. The one later commit (#168) is whitespace in a CI workflow. Prepush, prettier on every file changed since `shop-v0.6.50` and `locks-sdk-smoke` passed on `fb85c3313`.
- Served build: `/version.json` reports `shop-v0.6.51` and this commit, and the `build` meta tag carries it. The Locks SDK wasm is served (1,313,137 bytes, matching sha256). USDT is off in the served configuration and on the service.
- #164 is live: the served chunks contain `refund_destination_confirmed`, "The buyer confirmed a USDT refund address" and "confirmed a USDT refund address for an order". The first two were absent on v0.6.50.
- Framing is still denied: `frame-ancestors 'none'` and `X-Frame-Options: DENY` on content routes, now set per request. The served configuration has no frame ancestors and `embedded: false`.
- Production, signed in: 68/68.
  - Sign-in with Ring and Bitkit under the new storage namespace, and sign-out.
  - PayPal offered and selectable at checkout, read-only (no PayPal login, no Pay click).
  - Purchase approval opens a `signin_grant` QR.
  - Settings is in the shared navigation; cart, checkout, orders, My shop and storefront render at desktop and mobile width.
  - A Bitkit 2.5 buyer selects Bitcoin on a test listing with no Bitkit 2.6 or "Couldn't verify" notice.
  - USDT appears nowhere.
  - Every session the run created was revoked, and the test listing was deleted and verified gone.

## Tester notice

Tester notice: reload once. Your browser storage moves to the Shop's new namespace on first load, and you stay signed in. Close any Shop tab left open on the previous version.
