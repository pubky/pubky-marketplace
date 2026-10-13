# Seller-set delivery and completion periods

Two periods govern an order after it ships (or, for manual digital delivery,
after it is paid), and the seller sets both on the shop record:

| Shop-record field    | Meaning                                                                                                                                                  | Bounds    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `deliveryAssumeDays` | Days after shipment when delivery is assumed (no carrier feed); for manual digital delivery, days after payment when the seller never marks it delivered | 1–60 days |
| `autoCompleteDays`   | Days after delivery when the order completes unless a return opens                                                                                       | 1–60 days |

Both are optional integers. Unset means the transaction service's configured
defaults (`DELIVERY_ASSUME_DAYS`, `AUTO_COMPLETE_DAYS`, 14 days each) apply to
that period. The Shop shows those same 14-day defaults for a seller who left a
field unset (`COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS`,
`COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS` in `src/config/commerce.ts`).

## Where the Shop uses them

- **Seller settings** (My Shop → storefront settings): two optional number
  fields under "After purchase". A cleared field is published absent; saving
  never carries a previously published value forward.
- **Shop page**: one line states both periods, and says the delivered
  assumption is counted from payment for items the seller emails or sends in
  messages.
- **Checkout**: the order summary states them for every seller in the cart,
  one sentence when the sellers agree and one line per shop when they differ.
  The Shop reads the live shop record (`CommerceController.refreshShop`),
  falls back to the cached copy when the network read fails, and shows nothing
  for a seller whose record cannot be read at all, rather than a guess.

## What the transaction service does

At an order's first payment lock point (the payment-method bind,
`payment.prepare_locks`, the sandbox advance) the service reads the seller's
shop record from their homeserver and freezes both periods on the order. A
later change to the shop record does not move an open order's clock. The
sweeps that assume delivery and auto-complete use each order's own period.
The same two periods end a paid manual digital order ("I'll email it" / "I'll
send it in messages") the seller never marks delivered: delivery is assumed
after `deliveryAssumeDays` counted from payment, the order completes after
`autoCompleteDays`, and the buyer's sealed delivery email is then purged after
its retention. When the shop record exists but cannot be read, the payment
still starts: the order freezes the service's configured defaults and the
service logs an alert. The order projection carries `deliveryAssumeDays` and
`autoCompleteDays` (null when the seller left one unset); see the service
README, "Seller-set periods".

## Spec dependency

The record schema is shared with the `pubky-app-specs` fork
(`PubkyAppShop`), which defines both fields (optional, whole days, 1-60,
skipped when absent) from `0.6.2-marketplace.13`, the version pinned in
`vendor/pubky-app-specs`. `createShop` through the wasm builder keeps them,
rejects out-of-range values, and omits them for a shop that sets neither;
`commerce.specs.test.ts` pins that contract. The Shop still writes the shop
record as raw JSON validated by its own schema, so the fields reach Nexus and
other clients as spec fields without a second code path.

## `guaranteePolicyVersion`

Retired. The Shop no longer sends `guarantee_policy_version` on `checkout.create`
or `offer.checkout`, and its order projection no longer reads it. The service
still accepts the field from an older client and no longer projects it.
