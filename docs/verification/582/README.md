# PR 582 visual proof: staging orders from 2026-11-26

Proof that the client on `cursor/fix-581-upstream-inconsistent-orders-bdeb` (PR 582) renders James's real staging `GET /v1/orders` body. Re-verified on 2026-11-27 against PR head `9f7efa7a3d15dedae3ad33e2d690ac0180e6eb6c` (`fix(commerce): reconcile partial orders and payment reviews`, which includes `9f7efa7`). The captured JSON is `src/test/fixtures/marketplace/orders-staging-2026-11-26.json` (buyer `idgopdnhi9psboqguyzsmsj1hyyy7gks7wxa4ym9eazz6pibsfay`, seller `9kshs8g7cd33qr3jkg6hyu1nwayyrdp73qet3bi8yewncgbhcrxo`, 2026-11-26). Order `470c02d8-9326-4d89-98f6-199df5a2ffcb` is cancelled with `payment.state` `manual_review` and `payment.review_reason` `upstream_inconsistent`.

The images in this directory are the Chromium Linux captures. The same scenes are the Vitest browser baselines under `src/test/vrt/marketplace/__screenshots__/MarketplaceStagingOrders582.vrt.test.tsx/` (`*-chromium-linux.png` and `*-firefox-linux.png`).

Orders and Checkout load the fixture through the production path: `useMarketplaceOrders` → `CommerceController.fetchMarketplaceOrderList` → `CommerceApplication.fetchMarketplaceOrderList` → `MarketplaceGatewayService.getOrderList` → `MarketplaceTransactionService.getOrderList` (`GET /v1/orders`, bearer session, camelCase, `parseMarketplaceOrderList`). The visual test stubs the session, `fetch` for that URL, and page chrome (nav badge counts, the checkout form hook, cart, offers). It does not stub `useMarketplaceOrders` or `fetchMarketplaceOrderList`. The Greptile follow-up renamed `getMarketplaceOrderList` to `fetchMarketplaceOrderList` and removed the hook's fallback to `getMarketplaceOrders`.

The VRT clock is frozen at `2026-01-01T12:00:00.000Z`. The paying scene also pins `Date.now` to that instant so the hold countdown stays at `30:00`.

## Images

| File                                       | What it shows                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-orders-unavailable.png`            | Merge-base `5fe8f29e6` (without PR 582). The captured list fails as one parse, and Orders shows "The marketplace service is temporarily unavailable." No order cards.                                                                                                                                                                                                  |
| `before-checkout-paying-lost-order.png`    | Same merge-base, Checkout `?order=d06cc87e-60f8-4942-b1f2-1ca6c24b4535`. The list still contains exact `470c02d8-…`, so the whole read fails. The paying view says "This checkout is no longer waiting for payment." No order number and no pay-by time.                                                                                                               |
| `after-orders-list.png`                    | Buyer Orders on `9f7efa7`. All seven captured orders. `Order 470c02d8` is the history card, with badges "Waiting on seller", "Bought", "Cancelled", and "The payment provider reported an inconsistent payment status. The seller will check their wallet to see whether your payment arrived." The other six stay under Abandoned as "Checkout ended before payment." |
| `after-checkout-470c02d8-under-review.png` | Buyer Checkout `?order=470c02d8-…` on the exact fixture. `Order 470c02d8`, badge "Under manual review", and the same seller-will-check-their-wallet sentence.                                                                                                                                                                                                          |
| `after-checkout-paying.png`                | Checkout `?order=d06cc87e-60f8-4942-b1f2-1ca6c24b4535`. `Order d06cc87e`, "Awaiting payment · Item reserved · 30:00", and "Pay by 1 Jan 2026, 12:30." Byte-identical to the capture on `e3e37da`. The list for this scene still contains exact `470c02d8-…`.                                                                                                           |
| `after-orders-parse-error.png`             | The seven captured orders plus one malformed row. The inline card says "Order could not be displayed" and still names `bad0fdd4-109c-4b64-851b-e320b097adc8`. `Order 470c02d8` stays in the history section with the wallet-check sentence.                                                                                                                            |
| `after-orders-470c02d8-seller.png`         | The same list signed in as the seller. `Order 470c02d8` only. Copy: "Check your wallet and use the review form to record the outcome. No funds are held by this marketplace." The "Resolve payment review" form is on the card.                                                                                                                                        |

`470c02d8` is no longer an Abandoned card. A cancelled order whose payment is still `manual_review` stays in order history for both parties.

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

## Re-capture against `9f7efa7`

On 2026-11-27 the scenes were rendered again on Chromium and Firefox from `9f7efa7a3d15dedae3ad33e2d690ac0180e6eb6c`, with the previous baselines deleted first so Vitest wrote new PNGs. Compared with verification commit `e3e37da5ce03e9301b514fc59ef8cdd2ac999def`:

- `after-orders-list.png` changed. `470c02d8` moved out of Abandoned into the order history and shows the buyer wallet-check sentence. That matches the intent that an expired checkout with an unresolved payment stays visible.
- `after-checkout-470c02d8-under-review.png` changed. The old "under review / no settlement is assumed" sentence is now "The seller will check their wallet to see whether your payment arrived." The badge is still "Under manual review".
- `after-checkout-paying.png` is byte-identical. Order number, `30:00`, and "Pay by 1 Jan 2026, 12:30" are unchanged.
- `after-orders-parse-error.png` changed because `470c02d8` is now a history card beside the error card. The card still prints the malformed order id.
- `after-orders-470c02d8-seller.png` is new. It shows the seller wallet-check sentence and the review form.

The fixture has no observed USDT transfer (`payment.confirmations` is 0 and no payment asset is set), so the USDT return-address form stays hidden. That matches "collect a USDT return address if funds arrived" for this order; these images do not show that form.

The buyer history card also says "This order was refunded or cancelled, so the download is no longer available." The order state is `cancelled`. The unresolved payment is still shown on the same card.

The seller form says "This payment is held for manual review" and "the marketplace remains the authority" next to "No funds are held by this marketplace."

The inline parse-error card still shows the order id and the rejected value. The diagnostic report does not: the unit test asserts the logged issues are `payment.reviewReason: invalid_value` and do not contain the order or payment id.

These scenes do not cover a partial read preserving the unread badge, discarding pending reads on account switch, or the single checkout warning for an order the client cannot identify.
