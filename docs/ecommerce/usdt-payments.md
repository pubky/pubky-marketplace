# USDT payments (flagged, default off)

The Shop can carry USDT (USDT0 on Arbitrum One) as an asset a buyer can pay with in Bitkit, through the single "Pay with Paykit" checkout entry beside PayPal (decision PK1, below). It ships behind one flag and is off by default: with the flag off the Shop's behaviour for Bitcoin and PayPal is unchanged and nothing USDT-shaped is rendered.

## The flag

| Where                         | Name                                                          | Default | Meaning                                                                     |
| ----------------------------- | ------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Shop runtime config           | `PUBKY_RUNTIME_USDT_PAYMENTS_ENABLED` (`usdtPaymentsEnabled`) | `false` | The Shop may offer USDT                                                     |
| Marketplace service `/health` | `usdt_payments: { available: true }`                          | absent  | The service has USDT on; absent when its own `USDT_PAYMENTS_ENABLED` is off |

The service is authoritative. A new USDT offer needs both: the Shop flag on AND `/health` reporting `usdt_payments.available`. `useUsdtPaymentsCapability()` (via `CommerceController.fetchUsdtPaymentsAvailable`) is the one gate; USDT is offered only when its status is `available`. It is not available while loading and after a failed read, and with the Shop flag off it never calls `/health`.

The gate covers new offers only. An order that already carries `payment_asset: "USDT"` (or the legacy `payment_method: "usdt"`) is always parsed and displayed, so it never shows as Bitcoin and never strands money after a flag flip.

The flag does not cover the Locks path. Once locks#75 and a `[usdt]` Paykit config are deployed, a Locks invoice for a USD-priced locked listing offers USDT to every buyer of a seller who approved a USDT address, whatever this flag says: the invoice offers every approved option and neither the service nor the Shop shapes it. The flag only controls whether the Shop mentions USDT on that path. A `locked` settlement can also carry a USDT payment after locks#75, and the Shop will not know the rail, so a locked receipt must not be labelled "Bitcoin".

## Payment option model

`src/libs/commerce/payment-options.ts` separates the buyer-facing method label from what the buyer sends and where it settles:

- Method label (`PaymentMethodKind`, wire `payment_method`): `paykit`, `paypal`, and the legacy Paykit binds `bitcoin` and `usdt` that orders placed before PK1 still carry (`stripe` is read as unbound).
- Asset: `BTC`, `USDT` (fiat methods carry none; the asset is the order's own currency).
- Network: `bitcoin`, `arbitrum-one`.
- Settlement mode: `locked` (Lock Server entitlement) or a service-verified mode: `paykit`, `gateway-notified`, `processor`, `seller-attested`.
- Option id: `{method}.{asset}.{network}`, or `{method}.fiat` for fiat methods: `paykit.btc.bitcoin`, `paykit.usdt.arbitrum-one`, `paypal.fiat`, `stripe.fiat`.

The order projection accepts the optional, display-only `paymentAsset`, `paymentNetwork`, `paymentAmountMinor`, `paymentExponent` and `paymentQuoteBasis`. A value the Shop does not recognise is dropped for that order; it never fails the order parse. `formatUsdt` renders USDT millionths with six decimals. Receipts and summaries group the digits ("$1,250.00, paid as 1,250.000000 USDT", and the amount in a recorded refund line; UX audit P12) with `formatUsdt(millionths, { grouped: true })`; every amount the buyer must pay or the seller must send ("Pay exactly", the checkout quote, "Amount to send", "Refund to send") stays ungrouped so it can be read back and copied digit for digit.

Listings stay priced in `USD/2` or `BTC/8`; USDT is a payment method, never a price currency. The same rule applies to Locks and Paykit requests: the lock or request asset is the price denomination, and a USD-priced listing may be paid in quoted BTC or USDT.

## Gated surfaces

- The seller's "How you get paid" settings render a USDT card (below) when `useUsdtPaymentsCapability()` reports `available`, or `unreadable` (the Shop flag is on but `/health` could not be read), in which case the card says USDT can't be checked right now instead of disappearing. With the Shop flag off, or `/health` answering without the key, there is no card.
- `availablePaymentMethods(config, { usdtPaymentsAvailable })` offers `paykit` (then `paypal`) and `sellerPaykitAssets(config, { usdtPaymentsAvailable })` names its assets: USDT only when the gate is on AND the seller's public config carries `usdtAvailable: true` (or lists `USDT` in `acceptedAssets`). Callers that omit the option get Bitcoin only.
- `getUsdtPaymentsEnabled()` (`@/config/commerce`) reads the runtime flag.
- The `/health` capability read sits beside `getDigitalDeliveryCapability` in `MarketplaceGatewayService`.

## Seller settings: Accept USDT

`MarketplaceGetPaidSettings` adds a "USDT" card after the Bitcoin card when the gate is on (`MarketplaceUsdtSellerSetup`). Flag off, the DOM and the save request are unchanged.

**Wire contract** (own payment configuration, `GET`/`PUT /v0/sellers/me/payment-config`; pinned in `src/libs/commerce/usdt-seller-setup.ts`, fixtures in `src/test/fixtures/commerce/seller-payment-config-usdt.wire.ts`). The fields exist only while the service's USDT flag is on:

| Field (wire / Shop)                     | Values                                   | Meaning                                                                             |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `usdt_enabled` / `usdtEnabled`          | boolean                                  | The seller's Shop-level consent, written by the toggle                              |
| `usdt_setup` / `usdtSetup`              | `ready`, `setup_required`, `unavailable` | The service's signed Paykit `/setup/status {asset: "USDT"}` result                  |
| `usdt_setup_action` / `usdtSetupAction` | `setup`, `reconnect`, `null`             | The Bitkit flow for a `setup_required` seller; `null` when `ready` or `unavailable` |

`deriveUsdtSellerReadiness` collapses them to `ready`, `setup`, `reconnect` or `unavailable`. Only a `ready` status from the service means ready: the sign-in type never decides it, and a Ring-only seller is never ready. A missing or unknown status, or `setup_required` without a usable action, fails closed to `unavailable`, and `unavailable` never offers an authorization flow. A seller who has never saved a payment configuration has no own view (the service answers `null`), so the card reads `unavailable` until a first save.

**States and copy.**

| State         | Shown                                                              | Action                                                       |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `ready`       | "USDT ready"; the Accept USDT toggle is usable                     | none                                                         |
| `reconnect`   | "USDT needs Bitkit. Pubky Ring can't share a USDT address."        | "Add USDT in Bitkit" (reconnect iframe)                      |
| `setup`       | the same line                                                      | "Set up Bitkit payments" (setup iframe, as for Bitcoin)      |
| `unavailable` | the same line, "USDT can't be checked right now. Try again later." | "Check again" (re-reads the own configuration and `/health`) |

The toggle stays disabled until `ready` (it can always be switched off), and the seller's consent saves with the rest of the form. The own configuration is the single source of USDT readiness. A save sends `usdt_enabled` only when the own configuration reported it (the service reports `usdt_enabled`, `usdt_setup` and `usdt_setup_action` together, only while its flag is on), so saving PayPal or Bitcoin never resets the consent. A service without those keys (flag off, or S1 deployed without S2) never receives the field, which it would refuse as unknown and fail the whole save.

**Reconnect.** `CommerceController.getPaykitReconnectUrl` builds `GET <setup origin>/setup/reconnect?creator&return_to&state` beside the setup URL builder. Reconnect requires `creator` and upstream `/setup` rejects it, so reconnect always sends it. It runs in the same embedded iframe and `paykit-setup-callback` listener as setup. On completion the Shop re-reads the own configuration and closes the dialog only when the service now reports `ready`; otherwise it says Bitkit did not confirm a USDT address and offers Retry. The Shop never receives or displays the USDT address: it lives in Bitkit and paykit-server.

## Refund address (W4)

The marketplace never holds funds, so a USDT refund is two human steps the Shop only records: the buyer confirms an Arbitrum One USDT address on the order page, and the seller sends the refund with an ordinary USDT send in Bitkit and records the Arbitrum transaction hash with "Record refund". Nothing is detected or checked on-chain; the Shop never calls a recorded refund "verified" or "confirmed on Arbitrum", and the Paykit `resolved: refunded` outcome is an annotation, never a verified refund.

These surfaces render for any order whose projection carries `paymentAsset: "USDT"`, whatever the new-offer flag says: a USDT order that already exists must stay refundable after the flag flips. Bitcoin, PayPal and Stripe orders never carry the field, so nothing changes for them.

Wire contract with the service's S6 slice (`src/libs/commerce/usdt-refund.ts`, fixtures in `src/test/fixtures/commerce/usdt-refund.wire.ts`):

| What                                                    | Shape                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buyer command `refund.confirm_destination`              | `{ order_id, address }`; the buyer may replace the address until a refund is recorded, then the service answers `INVALID_STATE`                                   |
| Participant order projection `refund_destination`       | `{ address, network: "arbitrum-one", asset: "USDT", source, confirmed_at }`, null or absent until confirmed; `source` is only displayed                           |
| Seller command `refund.record_external` on a USDT order | `transaction_id` is the Arbitrum hash, `0x` + 64 hex (lowercase on the wire, the Shop lowercases what the seller pastes); refused without a confirmed destination |
| Refusal `reason` values                                 | `refund_destination_required`, `invalid_refund_destination`, `invalid_refund_reference`, each mapped to static copy                                               |

The address check is `0x` + 40 hex; a mixed-case address must carry a valid EIP-55 checksum, an all-lowercase or all-uppercase one is accepted as typed. The buyer must also tick "This address accepts USDT on Arbitrum One" and sees the exchange-deposit warning.

Both parties get a "Look up address on Arbiscan" link beside the confirmed address (the panels, the seller's resolve panel and the Record refund dialog), and the order card's recorded-refund line adds "Look up transaction on Arbiscan" for the recorded hash (UX audit P6). They are plain links to `https://arbiscan.io/tx/<hash>` and `/address/<address>`, worded as a lookup: the Shop never checks the transfer and never calls it verified. A recorded reference that is not exactly `0x` plus 64 hex characters gets no link, because it comes from the seller and never becomes part of a URL (`src/libs/commerce/arbiscan.ts`).

A USDT payment on an order priced in satoshis or BTC (one Paykit request carries USDT for every currency the service converts, with the rate fixed at prepare) is refunded in USDT0, not in the order's currency: the refund form starts at the whole amount paid (`payment_amount_minor`), accepts up to six decimals, and the service records `external_refund.amount_minor` in millionths, capped at the amount paid (`usdtRefundCap`, `formatUsdtRefundAmount`). A USD order keeps cents at parity. A return request in order units has no exact USDT figure, so the seller is asked to send the whole amount paid.

The "send it back to the address I paid from" choice appears only when the order projection carries an optional `payment_address`. The service does not send it today (paykit-server's status exposes no payer address), so the buyer enters an address.

## Resolving a USDT payment in manual review (W5)

A USDT payment can land in manual review (late, or an amount that does not match). The seller resolves it from the order's payment status card with the same three outcomes and the same endpoint as Bitcoin: `POST /v0/orders/{id}/bitcoin/resolve` with an `Idempotency-Key`, which the service's S6 slice widens from Bitcoin to USDT orders. The seller-confirmation step (`confirm-bitcoin-payment`) stays Bitcoin-only: USDT is paid at inclusion and has no such step.

The panel renders for any order whose projection carries `paymentAsset: "USDT"` (or the `usdt` method), seller only, Paykit payment in `manual_review`, whatever the new-offer flag says: an existing USDT order is never stranded. The Bitcoin panel and its schema are unchanged; the rail picks which one a hook and a card use (`paymentReviewRail`).

| What                                         | Shape                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcomes                                     | `paid`, `refunded`, `abandoned`, unchanged; `paid` is hidden while the payment review reason is `refund_required`                                                      |
| `external_refund_reference` of a USDT refund | The Arbitrum transaction hash, `0x` + 64 hex (lowercase on the wire; the Shop lowercases what the seller pastes). Bitcoin keeps its 1 to 64 printable ASCII characters |
| A USDT refund also needs                     | The refund address the buyer confirmed (W4). Without one the panel asks the seller to wait, and the service refuses with `refund_destination_required`                 |
| What a refund records                        | The whole quoted USDT amount in order units; the buyer's address is copied into `external_refund.destination_address`                                                  |
| Refusal `reason` values read in USDT terms   | `invalid_refund_reference` ("Enter the Arbitrum transaction hash (0x followed by 64 characters)."), `refund_destination_required`; every other reason keeps its copy   |

The panel shows the order total beside its parity USDT amount ("$137.00 · 137.000000 USDT"), the buyer's refund address and the amount to send, and says the refund is recorded by the seller and not checked on Arbitrum. Like the refund-address flow it never says "verified" or "confirmed on Arbitrum"; the Paykit `resolved: refunded` outcome the service sends afterwards is an annotation only.

The contract is pinned in `src/libs/commerce/usdt-payment-review.ts`, with wire fixtures in `src/test/fixtures/commerce/usdt-payment-review.wire.ts`. Until S6 merges they are hand-written from its PR; replace them with captures then.

## Sellers who accept USDT but not Bitcoin

One Paykit request pays such a seller too, so the default storefront (`shop.json`, which Bitkit needs to make a seller the buyer's contact) is published when the payment configuration has `bitcoinEnabled` or `usdtEnabled`, on save and on load (`CommerceController.putMyPaymentConfig` and `getMyPaymentConfig`).

## Deploy order

The Shop that accepts `usdt` in its order projection must be deployed before the service's USDT flag is ever turned on: an older Shop rejects an unknown `payment_method` and breaks the order page.

## Checkout, status and refusals (W3)

### One Paykit entry (decision PK1)

The checkout offers ONE "Pay with Paykit" entry beside PayPal, never separate Bitcoin and USDT entries. The buyer picks Bitcoin or USDT in Bitkit; one Paykit request carries every asset the seller accepts. The note under the picker says "Pay in Bitkit (Bitcoin or USDT)" when the gate is on and every seller in the cart takes USDT, and "Pay in Bitkit (Bitcoin)" otherwise (`paykitAwaitingTitle`, `src/libs/commerce/paykit-rail.ts`). A Locks checkout always says Bitcoin, and the sandbox, which binds no real rail, shows no note and never reads the USDT capability. The seller's "Accept USDT" toggle stays the seller's consent: the service turns it into the assets the request offers.

- The bind sends `{ method: 'paykit' }` (cart, drop, offer and the order page's picker, "Continue with Paykit"). Before payment the order shows a neutral state: "Pay in Bitkit (Bitcoin or USDT)" with "Approve in Bitkit within 15 minutes." and, when USDT is on offer, the Bitkit USDT hint and the finality expectation ("If you pay in USDT, the seller ships once Arbitrum finalizes your payment, usually within minutes.").
- The assets named come from the seller configs (`accepted_assets`, else `bitcoinAvailable` / `usdtAvailable`) at checkout and from the order's own `accepted_assets` once bound; an order that carries none was bound before the service reported them and means Bitcoin only. A multi-seller cart names only the assets every seller accepts and, when a seller who does not take USDT keeps it off, says who (`usdtMissingOptionExplanation`).
- USDT is no longer limited to USD totals at the picker. The service fixes one rate at prepare for a Bitcoin-priced or other-currency cart, so the Shop does not guess. The USDT figure it can state exactly, a USD total at parity, appears as "12.000000 USDT · USDT0 on Arbitrum One if you pay in USDT". The indicative bitcoin estimate stays while Bitcoin is on offer.
- After payment everything follows the rail the buyer ACTUALLY paid on. `observedPaymentRail` reads `payment_asset` (`BTC` or `USDT`, null until a payment is seen), and falls back to the legacy `payment_method` (`bitcoin` or `usdt`) for orders placed before PK1. Every rail-keyed table below (`bitcoin-buyer-status.ts`, `usdt-buyer-status.ts`, the refund and review copy) is reached through that one function; nothing is duplicated. A `paykit` order whose Bitcoin request is already seen (`detected`, `awaiting_seller_confirmation`, `confirmed`) follows the Bitcoin tables before `payment_asset` is recorded.
- A payment seen on both rails, or any review the service cannot attribute to a rail, shows the generic review copy, and the seller resolves it with the neutral "Resolve payment review" form.
- A bind refusal for `paykit` reads in Paykit terms, never "Bitcoin" or "USDT" (`PAYKIT_PAYMENT_METHOD_REASON_MESSAGES`).

Deploy order: the service that accepts the `paykit` bind goes first; this Shop merges after it. Orders already bound as `bitcoin` or `usdt` keep rendering unchanged.

Two more lines can follow the Paykit note (UX audit P3 and P13):

- When USDT is on offer, any cart with a shipped or pickup line adds the finality expectation above. A cart whose lines are all digital omits it, because a service-sealed digital line releases at inclusion.
- A cart with more than one seller adds "You'll approve one request per seller in Bitkit.", because the bind sends one Paykit request per seller.

Once the request is bound, the order page's neutral Paykit panel (`BuyerPaykitPaymentProgress`) shows the same accept-by line; a USDT-observed order's pay panel (`BuyerUsdtPaymentProgress`) adds "Approve in Bitkit within 15 minutes." under the "Pay by" line (UX audit P4). Paykit gives the buyer half the payment window, counted from activation, to approve the request (plan §2.4, D4), which is 15 minutes for the default 1,800 s window; the order carries no accept-by of its own, so `USDT_ACCEPT_BY_MINUTES` pins the default and must change with `USDT_PAYMENT_WINDOW_SECONDS`. It needs a Paykit that has the half-window accept-by (paykit-server #67, on `master`, in no deployed Paykit as of 12 Oct 2026), and it is hidden once the wallet delivery failed. The same panel repeats the finality line above for non-digital orders. The checkout itself never shows an accept-by line, because the window starts at activation.

### Order status

Everything below renders whenever an order's observed rail is USDT (`payment_asset: "USDT"`, or the legacy `payment_method: "usdt"`), whatever the flag says. It lives in `usdt-buyer-status.ts` as its own rail-keyed table; the Bitcoin tables are untouched and a USDT order that carries a Paykit request state is never read as a Bitcoin order.

| Phase                                                      | Buyer                                                                            | Seller                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| awaiting                                                   | Waiting for your USDT payment                                                    | Waiting for the buyer's USDT payment                                                         |
| received (paid at inclusion, finality `pending` or absent) | USDT payment received. The seller ships once Arbitrum finalizes it.              | Payment received. Don't ship yet: Arbitrum hasn't finalized it. Shipping unlocks on its own. |
| final                                                      | USDT payment confirmed                                                           | Payment final. You can ship.                                                                 |
| re-checking (finality `reverted`)                          | Your payment is being re-checked on Arbitrum. You don't need to do anything yet. | The buyer's payment is being re-checked on Arbitrum. Don't ship.                             |

While a payment is re-checking, the seller also reads "If the payment doesn't come back, check Bitkit before approving any cancellation." (UX audit P10). It follows plan §2.5: money that never settled owes no refund, and the seller checks Bitkit before approving. The order carries no re-check timestamp, so the line is conditional and shows for the whole re-checking phase rather than only after a long one; a threshold needs a field from S3.

A paid order shows "$137.00, paid as 137.000000 USDT" and the network on the status card and in the receipt. A manual-review USDT payment reuses the existing review copy for the buyer; an amount mismatch reads "The USDT amount does not match. The seller is reviewing it." The seller's line is keyed to the review reason (UX audit P11): `late_settlement` reads "This USDT payment arrived after the payment window ended, so you decide the outcome below. No funds are held by this marketplace.", `amount_mismatch` reads "This USDT payment doesn't match the order total, so you decide the outcome below. No funds are held by this marketplace." `refund_required` keeps its own copy, and an unpinned or missing reason keeps the generic review line.

A Locks-verified (`locked`) receipt carries no payment method, so it is never labelled Bitcoin; after locks#75 the rail that paid it may be USDT and the Shop does not know which.

### The pinned service contract

`src/libs/commerce/usdt-settlement-contract.ts` holds everything the Shop assumes about the upcoming service status work (S3), so the real fields swap in at one file:

- `payment_finality` on the order projection: `pending | final | reverted`, tolerant (an unknown value reads as absent). Absent on a paid USDT order fails closed to "received, not final".
- The command refusal `error.reason === "payment_not_final"` on `fulfillment.ship`, `fulfillment.mark_ready` and `fulfillment.confirm_pickup`.

`src/test/fixtures/commerce/usdt-orders.ts` pins the wire shapes. They are hand-written from the plan until a real service build produces captured responses.

### Fulfilment gate

Until a USDT payment is `final`, Add tracking, the shipping label's "Mark shipped", Mark ready for pickup and the pickup handover are disabled, and the seller sees "Wait to ship: this USDT payment isn't final on Arbitrum yet. This usually takes a few minutes." A refusal from the service shows the same copy. Service-sealed digital orders release at inclusion and are never gated.

### Why the Paykit entry may not say USDT

When a seller in a multi-seller cart does not take USDT, a muted line under the picker says why (UX audit P5, `usdtMissingOptionExplanation`): "USDT isn't available for this cart: Film Camera Supply doesn't accept USDT." It shows only when the gate is open and at least one seller in the cart takes USDT, so a cart whose sellers never offered USDT stays silent, and never in the sandbox or on a Locks checkout. The order page's method picker has no such line.

### Refusals

| Reason                                                                                    | Copy                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `buyer_paykit_wallet_required`, `paykit_*`, `seller_account_unclaimed` on a `paykit` bind | The Bitcoin string with "Paykit" for "Bitcoin" (`PAYKIT_PAYMENT_METHOD_REASON_MESSAGES`)                                           |
| `seller_setup_pending` on a `paykit` bind                                                 | This seller's Paykit setup isn't finished, so they can't take a payment yet. Choose another payment method, or contact the seller. |
| `usdt_unavailable`, `usdt_seller_not_ready`, `buyer_usdt_wallet_required` (reserved)      | Static USDT copy in the main table, for a service that still answers with them                                                     |

A `paykit` bind tags its refusal with `context.paymentMethod: "paykit"` so the toast picks the Paykit string; a legacy Bitcoin or PayPal refusal is unchanged. The USDT refusal memory (`usdtRefusals`) is gone: nothing binds `usdt` any more, so there is no repeated refusal to remember.

### Not in W3

- Notification copy for payment and finality events: the closed notification types carry no asset, and the service has not named those USDT types. The one USDT type the service emits today, `refund_destination_confirmed` (S6, seller only), is in the closed set and reads "The buyer confirmed a USDT refund address". Deploy this before S6 so sellers never see "unrecognized marketplace event".
- A Locks pay-step hint "Bitcoin or USDT": it needs locks#75 deployed, and nothing signals that to the Shop yet.
- The seller manual-review resolution for a USDT payment (W5), and the USDT refund address and hash (W4).
