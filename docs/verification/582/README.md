# PR 582 visual proof: staging orders from 2026-11-26

Proof that the client on `cursor/fix-581-upstream-inconsistent-orders-bdeb` (PR 582) renders James's real staging `GET /v1/orders` body. Re-verified on 2026-11-27 against PR head `dc7099c7a879f8de04e1b6338b79c619a9177503` (`fix(commerce): address Greptile review feedback on order list reads`, on top of `4c8fee282`). The captured JSON is `src/test/fixtures/marketplace/orders-staging-2026-11-26.json` (buyer `idgopdnhi9psboqguyzsmsj1hyyy7gks7wxa4ym9eazz6pibsfay`, 2026-11-26). Order `470c02d8-9326-4d89-98f6-199df5a2ffcb` has `payment.review_reason` `upstream_inconsistent`.

The images in this directory are the Chromium Linux captures. The same scenes are the Vitest browser baselines under `src/test/vrt/marketplace/__screenshots__/MarketplaceStagingOrders582.vrt.test.tsx/` (`*-chromium-linux.png` and `*-firefox-linux.png`).

Orders and Checkout load the fixture through the production path: `useMarketplaceOrders` → `CommerceController.fetchMarketplaceOrderList` → `CommerceApplication.fetchMarketplaceOrderList` → `MarketplaceGatewayService.getOrderList` → `MarketplaceTransactionService.getOrderList` (`GET /v1/orders`, bearer session, camelCase, `parseMarketplaceOrderList`). The visual test stubs the session, `fetch` for that URL, and page chrome (nav badge counts, the checkout form hook, cart, offers). It does not stub `useMarketplaceOrders` or `fetchMarketplaceOrderList`. The Greptile follow-up renamed `getMarketplaceOrderList` to `fetchMarketplaceOrderList` and removed the hook's fallback to `getMarketplaceOrders`.

The VRT clock is frozen at `2026-01-01T12:00:00.000Z`. The paying scene also pins `Date.now` to that instant so the hold countdown stays at `30:00`.

## Images

| File                                       | What it shows                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-orders-unavailable.png`            | Merge-base `5fe8f29e6` (without PR 582). The captured list fails as one parse, and Orders shows "The marketplace service is temporarily unavailable." No order cards.                                                                                                                                       |
| `before-checkout-paying-lost-order.png`    | Same merge-base, Checkout `?order=d06cc87e-60f8-4942-b1f2-1ca6c24b4535`. The list still contains exact `470c02d8-…`, so the whole read fails. The paying view says "This checkout is no longer waiting for payment." No order number and no pay-by time.                                                    |
| `after-orders-list.png`                    | PR 582. All seven captured orders. `Order 470c02d8` is the third card (Digital Deduction, CHF 169.42, placed 26 Nov 2026, 12:39). Unpaid cancellations sit under Abandoned with "Checkout ended before payment."                                                                                            |
| `after-checkout-470c02d8-under-review.png` | PR 582, Checkout `?order=470c02d8-9326-4d89-98f6-199df5a2ffcb` on the exact fixture. `Order 470c02d8`, badge "Under manual review", and the sentence "The payment provider reported an inconsistent payment state, so this payment is under review. No settlement is assumed until an operator reviews it." |
| `after-checkout-paying.png`                | PR 582, Checkout `?order=d06cc87e-60f8-4942-b1f2-1ca6c24b4535`. `Order d06cc87e`, "Awaiting payment · Item reserved · 30:00", and "Pay by 1 Jan 2026, 12:30." The list for this scene still contains exact `470c02d8-…`.                                                                                    |
| `after-orders-parse-error.png`             | PR 582. The seven captured orders plus one malformed row. The inline card says "Order could not be displayed" / "Parse error" for `bad0fdd4-109c-4b64-851b-e320b097adc8`, and `Order 470c02d8` is still in the list below it.                                                                               |

The under-review sentence is on the checkout paying view. The Orders list does not render a payment card for an unpaid cancellation, so that sentence is not on `after-orders-list.png`. The order is still listed there as `Order 470c02d8`.

## Derived paying order

Every captured order is `cancelled`, so the paying scene adds one labelled copy of `06cc87e9-60f8-4942-b1f2-1ca6c24b4535` and leaves that source row in the list. The copy's short reference is `d06cc87e`. `470c02d8-…` is not modified.

Identity, so the copy is a second order and its embedded payment still names it:

| Path               | From                                   | To                                     |
| ------------------ | -------------------------------------- | -------------------------------------- |
| `id`               | `06cc87e9-60f8-4942-b1f2-1ca6c24b4535` | `d06cc87e-60f8-4942-b1f2-1ca6c24b4535` |
| `payment_id`       | `7f3b222b-0473-4987-bc88-bdd6ad9311b1` | `d7f3b222-0473-4987-bc88-bdd6ad9311b1` |
| `payment.id`       | `7f3b222b-0473-4987-bc88-bdd6ad9311b1` | `d7f3b222-0473-4987-bc88-bdd6ad9311b1` |
| `payment.order_id` | `06cc87e9-60f8-4942-b1f2-1ca6c24b4535` | `d06cc87e-60f8-4942-b1f2-1ca6c24b4535` |

Payment window, the fields changed so checkout shows an open payment:

| Path              | From        | To                                                                 |
| ----------------- | ----------- | ------------------------------------------------------------------ |
| `state`           | `cancelled` | `pending_payment`                                                  |
| `payment.state`   | `expired`   | `awaiting_entitlement`                                             |
| `hold_expires_at` | `null`      | `2026-01-01T12:30:00.000Z` (30 minutes after the frozen VRT clock) |

`paykit_request_state` is already `pending` on the source and is not rewritten. Every other field is copied unchanged. The unit test asserts this path list.

## Malformed row

`after-orders-parse-error.png` appends a copy of `0fdd4ee2-109c-4b64-851b-e320b097adc8` with:

| Path                    | To                                     |
| ----------------------- | -------------------------------------- |
| `id`                    | `bad0fdd4-109c-4b64-851b-e320b097adc8` |
| `payment_id`            | `bad7614d-638c-458d-8f22-46edc8b3b300` |
| `payment.id`            | `bad7614d-638c-458d-8f22-46edc8b3b300` |
| `payment.order_id`      | `bad0fdd4-109c-4b64-851b-e320b097adc8` |
| `payment.review_reason` | `not_a_real_reason`                    |

## Reproduce

Node 24 (`.nvmrc`). From the repo root, on this branch:

```bash
nvm use
npm ci
npm test -- src/core/services/marketplace/marketplace-staging-orders-2026-11-26.test.ts
npx playwright install chromium firefox
VRT_BROWSERS=chromium,firefox npx vitest run --project vrt-marketplace src/test/vrt/marketplace/MarketplaceStagingOrders582.vrt.test.tsx
```

With Docker, the Linux gate for this spec is:

```bash
bash scripts/vrt-linux.sh src/test/vrt/marketplace/MarketplaceStagingOrders582.vrt.test.tsx
```

That script runs Chromium and Firefox. Fresh captures are written only with `VRT_LINUX_UPDATE=1`. A compare run leaves the baselines in place and fails if pixels differ.

The before images are not produced by a test on this branch. They were captured from a detached worktree at merge-base `5fe8f29e6d8f85865758e71499073afb80883c45`, using the same fixture and the same session/`fetch` harness, with assertions for the unavailable alert and the lost paying view. That spec was not committed. The merge-base with `master` is still that commit, so the before images were not recaptured.

## Re-capture against `dc7099c`

On 2026-11-27 the four `after-*` scenes were rendered again on Chromium and Firefox from `dc7099c7a879f8de04e1b6338b79c619a9177503`, with the previous baselines deleted first so Vitest wrote new PNGs. All eight baselines are byte-identical to the captures from verification commit `2c27554d1b0557b3c7a650d20f6e6511c47d3fc4`. There is no visual difference.

That match is expected. The Greptile follow-up renames the order-list read, drops the unreachable fallback in `useMarketplaceOrders`, and keeps a known open-order warning visible beside the unchecked notice in the listing-delete dialog. It does not change Orders or Checkout copy, layout, or the parse of `upstream_inconsistent`. The listing-delete dialog is not in these scenes.
