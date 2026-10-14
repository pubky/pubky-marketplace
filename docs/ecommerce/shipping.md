# Shipping Tooling: Address Book, Presets, Tracking, Packing Slips

Post-purchase logistics for the marketplace: where each piece of shipping
data lives, who can read it, and what is deliberately not built. Read
[`status.md`](status.md) first for the general real-vs-simulated map.

Last updated: 2026-10-12.

## Where shipping data lives

| Data                                                              | Lives                                                                                                                                                                                                                                | Who can read it                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buyer address book                                                | Account-scoped IndexedDB (`commerce_delivery_addresses`), this device only                                                                                                                                                           | Only this browser profile. Never on the homeserver, never in any public record, never in telemetry.                                                                                                                                                                                                                                          |
| Delivery address of an order                                      | The transaction service stores only an HPKE-sealed envelope (`orders.delivery_address_envelope`), encrypted on the buyer's device to the shipping seller's delivery key; the service deletes it when the order reaches a final state | Only the seller's device, which holds the private key. The service, the operator and every other projection see ciphertext at most. Orders that predate sealing may still carry a `plaintext_v1` value until the service purges it. Design and threat model: [`encrypted-delivery-address-design.md`](encrypted-delivery-address-design.md). |
| Seller delivery key                                               | Public half on the seller's homeserver (`/pub/pubky.app/marketplace/v1/delivery-keys/current`); private half wrapped under a non-extractable key in a separate IndexedDB on the seller's device                                      | Public half: anyone. Private half: that browser profile only. Losing the device loses the ability to open addresses sealed to that key.                                                                                                                                                                                                      |
| Seller Shippo token, ship-from address, purchased label reference | Device-local, wrapped at rest under the same device key (`putDeviceRecord`)                                                                                                                                                          | Only that browser profile. Never sent to the marketplace service; the token goes to Shippo only.                                                                                                                                                                                                                                             |
| Seller shipping presets                                           | Account-scoped IndexedDB (`commerce_shipping_presets`), this device only                                                                                                                                                             | Only this browser profile. Presets are authoring convenience; nothing about them is published.                                                                                                                                                                                                                                               |
| Listing shipping option                                           | The owner-signed listing record (`shippingOptions`, one flat-rate entry)                                                                                                                                                             | Public, like the rest of the listing record. The sell studio now authors its label, price, and min/max day estimates (previously label and days were fixed copy).                                                                                                                                                                            |
| Shipment carrier + tracking                                       | The transaction service's order `shipment` object                                                                                                                                                                                    | Both order participants, via their scoped order reads. `carrier` and `tracking_number` are structured fields in the existing ship command contract.                                                                                                                                                                                          |

## The delivery-address privacy boundary (exact)

This is load-bearing; the service side is in `pubky-marketplace-service`
(`docs/` there and migration 0057):

1. The buyer's address is sealed **on the buyer's device** to the delivery key
   of each seller who ships part of the cart (RFC 9180 HPKE, base mode,
   DHKEM(X25519)/HKDF-SHA256/ChaCha20-Poly1305), bound to the checkout command,
   buyer, seller and key id. It leaves the browser only as that envelope inside
   `checkout.create` (`delivery_address_envelopes`), the offer checkout
   (`delivery_address_envelope`), a drop claim, or, for an auction winner,
   the payment-method bind (`POST /v0/orders/{id}/payment-method`). The
   winner's order exists from the auction close without an address, so the
   order page asks for it above the payment methods and the bind refuses an
   auction order that has none. The envelope is bound to the order id in
   place of a checkout command id, which the seller's projection returns as
   `command_id`.
2. The service validates the envelope's shape and size, stores the ciphertext,
   and cannot open it. Command results and exact replays never echo it.
3. The seller's single-order projection carries the envelope in an
   `hpke_v1` object while the order is `paid`/`processing` and `shipping`;
   every other projection withholds it. Legacy rows still project
   `plaintext_v1` until the service purges them.
4. The seller's client opens the envelope with the delivery key kept on the
   seller's device. An unknown key id or an envelope that fails authentication
   is a hard stop: no address, no Shippo call, and the UI says "Do not ship
   yet".
5. At `completed`, `cancelled`, `refunded_external` or `closed` the service
   deletes the ciphertext. A seller without a published key cannot receive a
   shipping checkout; the buyer is told before anything is reserved (an inline
   notice beside Pay, which stays until the next attempt). The seller cannot
   publish or save a listing that ships until the key is published, and
   Payment settings lists the delivery key as a setup step linking to
   Shipping settings, where it is created.

What that means for the tooling here:

- The **address book** is buyer-side only and purely device-local. The
  checkout picker fills the same form checkout always had; the address is
  then sealed to the seller before it goes into the buyer's own command.
- The **packing slip** opens the sealed address on the seller's device (see
  "Packing slip" below) and never falls back to a pasted or guessed address.
- The slip (and the order rows) now show the buyer's **variant snapshot**
  when the checkout carried one: `checkout.create` lines accept an optional
  `variant_id` plus up to three `{name, value}` option pairs (an ordered
  array, safe through the wire-casing layer), which both engines echo
  verbatim onto the order line. It is a buyer-supplied display snapshot —
  listing registration carries no variant inventory, so the service
  validates its shape, not its truth against the owner-signed listing
  content; like `quantity`, the seller sees the claim and fulfills or
  refuses it. Orders placed before the field existed simply have no
  variant line.

## Structured carrier tracking

The service's `fulfillment.ship` command already takes structured fields —
`carrier` (trimmed free string, 1–100 chars) and `tracking_number` — and
stores them in the participant-visible `shipment` object. **No contract
change was needed and none was made**; wire casing stays snake_case per
ADR-0019 §3 via the existing wire-casing layer. The service now additionally
rejects control characters in both fields (a charset floor, not a vocabulary
lock — international carrier names stay valid) and documents this client's
canonical carrier names as its soft vocabulary on `ShipOrderPayload.carrier`,
deliberately without an enum so foreign clients can ship other carriers.

Encoding decision: the ship dialog offers a curated carrier select, and the
client writes the selected carrier's **canonical display name** (e.g.
`Royal Mail`) into the existing `carrier` field. "Other" passes the seller's
free-text carrier name through verbatim. On read, the client resolves the
stored string back against the registry (case-insensitive, plus known
aliases like "Hermes" → Evri); resolution failure renders the carrier as
plain text with **no** tracking link — an unknown carrier never produces a
dead or wrong URL, and neither does a tracking number that does not look
like a real reference.

Curated registry (`src/libs/commerce/carriers.ts`), each with a public
tracking URL template: USPS, UPS, FedEx, DHL, Royal Mail, DPD, Evri
(Hermes), PostNL, Correos, La Poste, An Post, Deutsche Post, plus "Other"
(no template). Every template is unit-tested
(`src/libs/commerce/carriers.test.ts`).

The buyer's order timeline renders "Track package" linking to the carrier's
public tracking page when — and only when — the stored carrier resolves and
the tracking number is linkable. Existing orders shipped before the select
existed (arbitrary free-text carriers) keep rendering as plain text.

## Seller shipping presets

Sellers previously re-entered the flat shipping price per listing while the
option's label ("Seller shipping") and 3–7 day estimate were fixed copy. The
sell studio now authors all four fields (label, flat price, min/max days),
and presets template them:

- **Save as preset** in the sell studio's shipping section stores the current
  four fields; **Apply a saved preset** fills them while composing or
  editing.
- Presets are managed at `/marketplace/settings/shipping` (linked from My
  shop).
- The published record shape is **unchanged**: one flat-rate
  `shippingOptions` entry either way. A preset is never published, referenced,
  or synced.

## Buyer address book

- Saved/labeled addresses at `/marketplace/settings/addresses` and inline
  from checkout ("Save this address on this device for next time" + label).
- The checkout picker orders addresses default-first, then by most recent
  use; the top address pre-fills the form once (never over typed input), and
  editing a picked address turns the entry back into a new one.
- Validation follows the per-country table in [`postal-address.ts`](../../src/libs/commerce/postal-address.ts): region is required only where carriers need a subdivision (US/CA/AU/BR/IN/MX and similar), labelled State/Province/Region accordingly, with a type-to-filter list for US/CA/AU. US ZIP fills City + State on-device. Address line 1 suggests addresses from OpenStreetMap data through the marketplace service; see [`checkout-address-design.md`](checkout-address-design.md) and [`address-autocomplete-design.md`](address-autocomplete-design.md). A saved address is always submittable.
- The first saved address becomes the default; the default is exclusive and
  changeable from the settings surface.

## Packing slip

From a seller's view: a print-friendly slip (browser `@media print` CSS
keyed on `data-packing-slip` in `globals.css` — no PDF dependency) with the
order id, order date, line items and quantities, totals, the buyer's short
pubky, shipment facts once tracking exists, and a notes area. For a paid or
processing shipping order the dialog opens the sealed address on this device
and prints it in the "Deliver to" block. If this device holds no key that
can open it, the slip says so and shows no address; there is no paste
fallback. Shipped, absent and non-shipping orders show the truthful
no-address notice. Line items include the buyer's variant snapshot when the
checkout carried one (see "Where shipping data lives" above); orders placed
before the field existed have no variant line.

Guarantees for the opened address:

- It lives in **component state of that dialog only**. It is not written to
  Dexie, localStorage, sessionStorage, cookies, or the URL, and is dropped
  when the dialog closes, the route changes or the account switches.
- It is **never sent** anywhere by this client except to Shippo when the
  seller asks for rates or a label (below).
- It is **never logged**, and error contexts never carry it.
- **Print-output caveat:** using Print, including print-to-PDF or a network
  printer, puts the address into that output. The file or print job is
  outside the app; delete it when you are done if you do not want a copy.

## Shippo labels (seller device only)

The seller supplies their own Shippo API token and a ship-from address in
Get Paid → Shipping. Both are stored encrypted on that device and are never
sent to the marketplace service, which does not call Shippo at all. For a paid
order the seller confirms a parcel; the Shop opens the delivery address on the
device, quotes real rates from `api.goshippo.com` (which answers CORS
preflights for an `Authorization` header from any origin, checked 12 Oct
2026), buys the chosen rate (real money, charged by Shippo to the seller's own
account) and keeps the label reference on the device for reprinting. The
tracking number goes through the existing `fulfillment.ship` command, so the
buyer sees it exactly as with a manually entered number.

- Shippo necessarily receives the plaintext address of the order it is asked
  to quote or label. The dialog says so; the service never does.
- Settings and labels do not follow the seller to another browser, and
  clearing the browser's data removes them.
- A failed Shippo call shows static copy keyed by a reason
  (`shippo_key_invalid`, `shippo_rejected`, `shippo_unavailable`); Shippo's own
  messages can quote the address and are never shown or logged.
- If storing the label fails after a successful purchase, the label exists
  at Shippo but not on the device; the seller can void or find it in Shippo.
- The page CSP only sets `frame-ancestors`, so no `connect-src` change is
  needed; add `https://api.goshippo.com` there if a stricter policy is ever
  introduced.

## Follow-ups (deliberately not built)

- **Service-side shipment enrichment** (shipped-at estimates, delivery-day
  windows, carrier enum server-side). The `carrier` field staying a free
  string is the service's contract; a server-side curated enum would be a
  service change, not a client one.
- **Live carrier tracking status and Shippo webhooks.** Labels are bought
  from the seller's device; tracking status is still seller-entered, with no
  carrier webhooks.
- **Syncing Shippo settings across a seller's devices.** Deliberately not
  done: the token would have to leave the device.
- **Multiple shipping options per listing.** The record supports up to 20;
  the sell studio still authors exactly one flat-rate option. Presets make
  the single option cheap to reuse; a multi-option composer is future work.
