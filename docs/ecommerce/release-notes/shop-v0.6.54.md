# Shop v0.6.54

> **Draft. The cut waits for [Shop #198](https://github.com/pubky/pubky-marketplace/pull/198) and [pubky-app #2821](https://github.com/pubky/pubky-app/pull/2821) to merge.** They are the embedded mount at `pubky.app/shop` and must ship together; both are still open as drafts. #198 conflicts with current `master`. This file lists what is merged today and what #198 adds. Remove this notice, and fill the cut fields below, when the release is cut.

**Date:** cut day (WEST)
**Commit:** the `master` commit that deploys, after #198 (exact SHA recorded at the cut)
**Vercel deployment / rollback target:** recorded at the cut (`vercel inspect shop.pubky.app --scope synonymdev`)
**marketplace-service:** `main` at `d8c47a8` or newer (see the service `CHANGELOG.md`). Deploy the service first.

Range: `shop-v0.6.53..master`. Pull requests merged: #194, #195, #196, #197, #199, #200, #201, #202, #204, #205, #206, #207, #208, #210, #211, #213, #214, #215, #216, #220, #221. Pending in this release: #198 (and pubky-app #2821).

## What changed for users

- **A Shop that lives inside pubky.app.** The Shop can be served at `https://pubky.app/shop` (the App's page around a same-origin Shop build at `/shop-embed`). Share links, report links and canonical and Open Graph URLs point at `/shop`; assets, API calls and the Passport return stay on `/shop-embed`. A standalone Shop is unchanged. (#195, #210; #198 completes the sign-in side)
- **A legal strip inside the embedded Shop.** Every page names the contracting entity (Synonym Software, S.A. de C.V.), opens the Terms of Service, gives the complaint address and points to Report listing. (#196)
- **Keyboard-reachable legal links.** The Terms of Service, Privacy Policy and age links in the landing and onboarding footers are real buttons with a visible focus ring; the contracting entity name comes from one constant. (#197)
- **Sign-in page copy.** The page no longer repeats Pubky Ring's permissions under the QR, adds a note under Continue with Google, or shows the Bitkit identity hint. (#215)
- **Sign-in with grants (pending #198).** Shop sign-in uses grants for Ring, Bitkit, Passport and recovery keys. Existing cookie sessions require a new sign-in. When embedded on the App's origin, the Shop reuses the App-owned session and logout; marketplace purchases still need their own approval. (#198, with pubky-app #2821)
- **Auction winners.**
  - The order page asks where to ship before the payment methods, and sends the address sealed to the seller with the chosen method; before, an auction order had no delivery address at all. (#207)
  - The order shows the end of the 30-minute winner window as its deadline; once the Bitcoin request is activated it shows that request's own deadline, so "Pay by" matches Bitkit. (#207)
  - A winner with too little time left for Bitcoin sees why and is pointed at another method or the seller, not a generic refusal. (#208)
  - Needs the service's #121, #122, #123 and #125: unpaid auction orders are cancelled once the winner's reservation lapses. (service)
- **Delivery key.** It is now a selling setup step: Payment settings shows it with a link to Shipping settings, and a listing that ships cannot be published or saved until the key is published. A buyer who presses Pay on an item whose seller has no delivery key sees why, inline beside Pay, in checkout, offer checkout and drop claims. (#205)
- **Locks listings are digital end to end.** The Shop registers them with digital delivery only; the listing page, cart, checkout and order cards show digital delivery with no shipping cost, ship-from or delivery address. (#207)
- **Bitkit setup and Lock Server copy.** A Bitkit setup approved under a different key is named on the dialog and stays under Step 2 with Try again; an unreadable claim status no longer reads as a wrong key. Lock Server connect copy no longer says Ring or Bitkit can approve it unless the Lock Server offers a Bitkit sign-in. Checkout says the Bitcoin payment adds a small unique amount only on deployments whose Paykit adds one. (#205)
- **The Shop follows the seller for you.** It follows a seller on Pubky, quietly and only once, when you add their item to the cart, check out, add it to your watchlist, follow their shop, make an offer or place a bid. A follow you remove is never added again, and Settings, Privacy says so. Bitkit only links contacts, so this is what lets a first-time buyer's Bitcoin request reach the wallet. (#220)
- **Bitkit contact hint.** Bitcoin checkout no longer asks you to check your Bitkit contacts once the request is sent; the "Waiting for your wallet" step now says Bitkit only receives requests from contacts. (#216)
- **First Buy click.** Pressing Buy right after the page loads no longer does nothing when the marketplace session restores in the background: the item is added to the cart, or the approval card stays open until you finish or cancel. (#213)
- **Catalog shop names on a cold start.** The catalog prerender gives each seller's shop record 3 seconds instead of 0.8, so a cold build or instance still renders shop names with Pubky SDK 0.16. (#204)

## Under the hood

- **Pubky SDK 0.16.0** (`@synonymdev/pubky`, was 0.11.0). Grant sign-in checks Web Locks and browser session storage before creating an approval request. (#194; #198 moves it to 0.16.1)
- **`pubky-app-specs` 0.6.2-marketplace.13**, with seller-set `deliveryAssumeDays` and `autoCompleteDays` on the shop record. (#201)
- **Grant sign-in client id.** `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID` (a bare host name, default `shop.pubky.app`) sets the client id signers show on their approval screen for the Shop's grant sign-in (`cid=` in the Bitkit link), so a deployment can name its own host: `pubky.app` in production, `staging.pubky.app` on staging. (#221)
- **Auction lengths.** `PUBKY_RUNTIME_AUCTION_DURATIONS_MINUTES` (JSON array of minutes, first preselected; default `[10080]`). A deploy with `PUBKY_RUNTIME_ENV=production` refuses lengths under one day, and duplicate lengths are refused; the select is hidden when editing a published auction. Left unset, the studio publishes 7-day auctions as before. (#202, #206)
- **Release tooling.**
  - `served-checks.mjs` now lives in the repository and reads every webpack chunk-map shape. (#211)
  - The release proof runs against a Shop mounted under a path (`PROOF_ORIGIN=https://pubky.app/shop`). (#199)
  - Install verification reads the Lock Server's `grant_connect` return origins, requires the Lock Server key in Paykit's `[signed_services]`, and takes `SHOP_PATH`, `SHOP_EMBED_PATH` and `SERVICE_PUBLIC_APP_ORIGIN`. (#195, #200, #210)
  - The live Locks payment test resolves the seller through the payments testnet. (#214)

## Operator actions

- **Build for the embedded mount:** `NEXT_PUBLIC_BASE_PATH=/shop-embed`, `NEXT_PUBLIC_DB_NAME=shop-franky`, `NEXT_PUBLIC_DB_VERSION=8`, no `NEXT_PUBLIC_SOCIAL_HOST`, no `NEXT_PUBLIC_ASSET_PREFIX`. Runtime: `PUBKY_RUNTIME_EMBEDDED=true`, `PUBKY_RUNTIME_STORAGE_ADOPT_LEGACY=false`, `PUBKY_RUNTIME_FRAME_ANCESTORS='self'`, `PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop`, `PUBKY_RUNTIME_DEFAULT_URL` set to the App origin, `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID` set to the App's host (`pubky.app`, or `staging.pubky.app`). Full list: [`docs/launch/shop-embedding.md`](../../launch/shop-embedding.md).
- **Allowed origins** on the service (`ALLOWED_ORIGINS`, `PUBLIC_APP_ORIGIN=<origin>/shop`, `SHOP_GRANT_ASSERTION_ISSUER`), Paykit, Locks, Nexus and the fiat verifier: the table in `shop-embedding.md`.
- **Shop BFF (pending #198):** the embedded sign-in needs the Shop BFF grant flow (`PUBKY_RUNTIME_MARKETPLACE_GRANT_FLOW_ENABLED` and `SHOP_BFF_GRANT_FLOW_ENABLED`) with its Postgres (`db/bff` 0001 and 0002), assertion key and the service's matching grant configuration. Deployment values and secrets are the deployer's.
- **`PUBKY_RUNTIME_SINGLE_APPROVAL_SIGN_IN`** is removed by #198; remove it from any deployment that sets it. `NEXT_PUBLIC_VIBE_SESSION_BRIDGE_ORIGIN` and `NEXT_PUBLIC_VIBE_ID` stay unset.
- **Deploy order:** service, then Shop; the App's `PUBKY_RUNTIME_SHOP_EMBED_ENABLED` only after the compatible Shop and BFF are live.
- **Build:** `--build-env SHOP_VERSION=shop-v0.6.54 --build-env GIT_SHA=<release commit>`.

## Known limitations

- Locks listings created before this release were registered for shipping and must be recreated as digital Locks listings (#207).
- Pubky Ring 2.0 crashes on launch on iOS 27 (2.0.1 pending). On Android, updating to 2.0 needs a restore from backup. (#126)
- Real signer, seller, payment and mobile-device flows through the App's wrapper need staging QA (#198).
- Bitcoin without Bitkit is not supported: Paykit is required ([#212](https://github.com/pubky/pubky-marketplace/issues/212) tracks the checkout UX).

## Verification

Recorded at the cut: `master` CI on the release commit, the served checks, and the production pass (`RESULT PASS n/n`) with the Vercel deployment id.

## Tester notice

Tester notice: log out and back in once. The Shop's database version did not change, but #198 moves sign-in to grants and existing cookie sessions must sign in again.
