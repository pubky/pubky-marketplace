# Pricing: Currencies, Indicative Conversions, and the Policy Gap

What a listing price is, what the "≈" estimates are and are not, and exactly where the
fiat↔BTC conversion question lives. Read [`status.md`](status.md) first for the general
real/simulated map.

## What a listing price is

Listing records carry structured money — `{amountMinor, currency, exponent}` — validated
by `commerceMoneySchema` (`src/libs/commerce/transaction-contracts.ts`). The schema
accepts any uppercase asset code with exponent 0–18; it is not a currency allowlist. The
record schema additionally forces one asset per listing: the primary price, every variant
price override, and the flat shipping price must share the same `{currency, exponent}`
(`src/libs/commerce/marketplace-records.ts`).

The sell studio authors eight of the assets that schema permits, defined once in the currency
registry (`src/config/currencies.ts`):

| Studio choice      | Stored money                     | Input unit                                                          |
| ------------------ | -------------------------------- | ------------------------------------------------------------------- |
| US dollars         | `{currency: "USD", exponent: 2}` | dollars with at most two decimals (`125.00` → `amountMinor: 12500`) |
| Euros              | `{currency: "EUR", exponent: 2}` | euros with at most two decimals                                     |
| Swiss francs       | `{currency: "CHF", exponent: 2}` | francs with at most two decimals                                    |
| British pounds     | `{currency: "GBP", exponent: 2}` | pounds with at most two decimals                                    |
| Japanese yen       | `{currency: "JPY", exponent: 0}` | whole yen, no decimal point (`1500` → `amountMinor: 1500`)          |
| Canadian dollars   | `{currency: "CAD", exponent: 2}` | dollars with at most two decimals                                   |
| Australian dollars | `{currency: "AUD", exponent: 2}` | dollars with at most two decimals                                   |
| Bitcoin (₿)        | `{currency: "BTC", exponent: 8}` | whole bitcoin base units (`15000` → `amountMinor: 15000`)           |

Exponents are the ISO 4217 minor units. Fiat input is parsed exactly, as a decimal string and
never through floating point, and a fraction the currency cannot hold is refused rather than
rounded (`src/core/pipes/money/money.parse.ts`). The studio's `currency` enum is the
registry's code list, so adding a currency means adding one registry entry. Drafts saved
with the legacy `SATS` choice still restore, as `BTC`.

Bitcoin base units ARE the minor unit of BTC at exponent 8 — no conversion happens on
input, ever.
This is the exact shape the live regtest purchase paid
(`unitPrice: {amountMinor: 15_000, currency: 'BTC', exponent: 8}` against a lock
criterion of `{amount: "15000", asset: "BTC"}` — see `src/test/live/locks-payment.live.ts`).
Offers, counteroffers, and auction bids are always made in the listing's own asset; the
record schema and the transaction service both reject cross-asset amounts. A listing
priced in any other asset (a foreign record, e.g. SEK) still renders, but the studio
refuses to edit it (`unsupported`) rather than silently rewriting its price into an asset
it did not have. Saved shipping presets carry their own currency (existing ones are US
dollars). The studio offers them on every listing and, when a preset's currency differs
from the listing's, converts its flat price into the listing currency with the current
rate snapshot and says so before the seller saves, because the record's shipping price
must be in the listing currency.

BTC-at-exponent-8 money displays per BIP-177 everywhere: the bitcoin symbol followed by
grouped integer base units (`₿15,000`), which is the same exact amount as
`BTC 0.00015000` stated in its own minor unit. The words "sats"/"satoshis" appear
nowhere in the UI.

## What the "≈" hints are (indicative display only)

Prices always show in the listing's own currency (`€112.50` for a euro listing, never
silently re-expressed). Wherever a listing price renders (cards, detail, cart lines and
subtotals, order totals), an approximate converted hint can appear beside it, in the buyer's
display currency: `≈ CHF 100.00` beside a euro price for a buyer who displays in Swiss
francs. When the buyer's display currency is the price's own, the hint is the other side of
the fiat and bitcoin pair instead (`≈ ₿N` beside a fiat price, `≈ $X` beside a bitcoin
price). Honest treatment, enforced in code (`src/core/pipes/money/money.convert.ts`,
`MarketplaceIndicativePrice`):

- **Marked approximate.** Always prefixed "≈", with a tooltip: "At current rate,
  indicative only".
- **Rate source.** Blocktank's bitcoin rate feed at the runtime config's `exchangeRateApi`
  (default `https://api1.blocktank.to/api/fx/rates/btc`), the feed Bitkit shows, through the
  same-origin `/api/fx-rate` route (the upstream sends no CORS headers). It carries a
  `BTC<CCY>` ticker for every listing currency. One response is one snapshot: fiat-to-fiat
  hints are two tickers of the same snapshot (EUR→BTC→CHF), never rates from different
  moments. The snapshot is cached in memory and refetched when older than five minutes.
- **Exact arithmetic.** Conversion uses integer ratios and rounds half up to the target's
  minor unit; an estimate that rounds to zero shows nothing.
- **Rendered only when the rates are there.** No rate for either currency → no hint. Never a
  stale fallback, never an error state beside a price.
- **User-controlled.** The display currency is a device preference in the marketplace filter
  bar (all eight currencies). Marketplace settings → Display preferences → "Approximate
  price conversions" toggles the hint off; both persist on the device.
- **Display-only.** Nothing transactional reads the hint. It cannot change what a buyer pays
  or a seller receives. Checkout states the amount actually charged, which the marketplace
  service computes from a fresh rate at order time and records on the order.

## What the payment rails do today

- **The BTC rail pays BTC-denominated lock criteria.** A content lock's
  `paykit-payment` criterion carries `{amount, asset}` fixed at **lock creation**; the
  Paykit Server accepts only `asset: "BTC"` (`CriterionAsset::parse` in
  `paykit-server/src/domain/invoice.rs`). A bitcoin-priced listing whose lock says
  `{amount: "<base units>", asset: "BTC"}` is payable end to end — that is the verified
  live flow.
- **Fiat-priced Locks listings cannot take the BTC rail.** A lock's criterion fixes its
  asset and amount at lock creation, and the verifier attests against exactly that, so a
  fiat-denominated lock has no defined Bitcoin amount. The marketplace service therefore
  accepts a Locks-gated listing only in USD, BTC or SAT (`locks_currency_unsupported`
  otherwise). This does not describe ordinary marketplace orders: for those the service
  fixes a fresh Blocktank quote at bind (see the service's multi-currency notes), which is
  what checkout shows. This client converts nothing for payment.
- **A Bitcoin refund is in the sats received, whatever the price currency.** The
  service decides the refund's unit and cap and projects them on the seller's order as
  `refundCap` (`{amountMinor, unit, exponent}`): `sat` with the sats received for an order
  paid in Bitcoin; the USDT received for a USDT order, `usdt0` outside USD and `order`
  cents for a USD one; else `order` with the order total. The refund form starts at, and
  is capped at, that figure (`orderRefundEntry`) and sends its `unit` as `amountUnit`,
  which the service refuses when it no longer matches. The Shop does not work out the
  payment rail itself. A service that projects no `refundCap` gets the earlier entry
  (`orderAmountEntry`, a USDT order capped at the USDT received) and no `amountUnit`. A
  return request is entered in the order's own units (`orderReturnEntry`). Every recorded
  refund names its unit (`externalRefund.amountUnit`). Labels read a `sat` record against
  the seller's `refundCap` and a record in any other unit, or that names none, against the
  order total, or the USDT received in cents for a USD order paid in USDT. A partial refund leaves the order `refunded_external` like a full one, and
  the buyer sees no `refundCap`, so whether a sats refund is full comes from the service's
  `externalRefundFull`, which every participant sees (`satsRefundIsFull`). The buyer's
  label then names the sats refunded alone ("Partly refunded ₿X"). When neither the flag
  nor the cap is known, the line claims neither part nor all. Deploy the service before
  the Shop: against an older service the Shop has no `refundCap` and reads unnamed records
  in order units.
- **This app never authors content locks.** The listing studio cannot create a
  `digitalLock`; locks are created by external tooling against the Lock Server's
  creator-publishing API. So the studio's pricing choice does not by itself make a
  listing payable — the lock (where one exists) fixes the payable amount and asset.

## The conversion policy gap for content locks (deliberately not invented here)

For a fiat-priced Locks listing to be paid over the BTC rail, someone must decide **when the
exchange rate is sampled and who bears the drift**: rate at lock creation, rate at
invoice creation, a bounded quote window, or something else. That decision belongs to
the payment rails — the Lock criterion fixes the amount at lock creation, and the
verifier attests against exactly that amount — not to a display layer, and not to this
client. Inventing a conversion here would produce a number nothing would honor.

The indicative estimates in this app are therefore explicitly NOT a conversion policy:
they are marked approximate, they are never consumed by any payment path, and they can
be switched off.

## What the fiat-rails design resolves

The fiat rails design (`docs/ecommerce/fiat-rails-design.md` on branch
`marketplace/pr34-fiat-design`) dissolves most of the gap rather than solving it with an
exchange rate: a USD-priced listing maps 1:1 to a `{amount: "<cents>", asset: "USD"}`
lock criterion — already valid at the Lock Server today — verified by a fiat verifier
speaking the existing Paykit wire contract, with Stripe/PayPal settling in the
criterion's own asset. No fiat↔BTC conversion happens there either; each rail pays
criteria denominated in its own asset. What remains open after that design, recorded in
its §9: a single listing payable by BOTH rails (buyer picks BTC or USD at checkout)
requires two locks per listing or upstream `Any`-logic criteria, and converting
fiat-priced listings onto the Bitcoin rail still needs the rate-at-lock-creation /
rate-at-invoice decision if anyone ever wants it.

## Package measurements (related display preference)

Package dimensions and weight are canonical metric in the record — exact integer
millimeters and grams (`commercePackageSchema`), never anything else. The measurement
preference (marketplace settings → Display preferences, defaulting from locale: `en-US`
→ imperial, otherwise metric) only changes what the seller types (cm/g or in/oz,
converted exactly on save: 1 in = 25.4 mm, 1 oz = 28.349523125 g) and what buyers read
(one-decimal display). Conversion math lives in `src/libs/commerce/units.ts` with
round-trip tests.
