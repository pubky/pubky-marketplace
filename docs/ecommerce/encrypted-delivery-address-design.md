DESIGN STATUS: DECIDED (r5, 12 Oct 2026: owner approved the recommendations; J1-J8 closed in §J; implementation in progress)

# Encrypted buyer delivery address to seller

**Scope.** Shop at `master` and marketplace-service at `main` as of 12 Oct 2026. It follows the owner decision on pubky/pubky-marketplace#12: encrypt the address in the buyer client, store only ciphertext the service cannot open, and decrypt in the seller client. The owner approved the recommendations on 12 Oct 2026 (11:42 Lisbon) with one instruction: use existing, audited options; do not roll our own or add complexity.

r5 changes against r4: the sealing primitive is RFC 9180 HPKE (§D1) instead of a hand-assembled X25519 + HKDF + XChaCha20 construction; the envelope, AAD and padding are simplified; the key record is published by the Shop itself under the grant it already holds (§C); offer checkout and drop claims are in scope; Shippo moves to the seller's browser (§E, §F); legacy plaintext is purged (§F); J1-J8 are closed (§J).

V1 covers every order created by `checkout.create` and `offer.checkout` that ships. Auction-won orders carry no address in the service today (`handlers/auction.rs` inserts the column as NULL) and keep conversation-based exchange; they must not gain a plaintext path.

## A. Data flow before this work

This section records the flow as of r4, before the stacked implementation; later slices change it as described in §F.

| Field                                                                                 | Who writes it                                   | Stored today                                                                                                                                                                                                   | Who can read today                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout `deliveryAddress` (`name`, street lines, city, region, postal code, country) | Buyer form / saved-address selection            | Browser form, then `checkout.create` command (`src/hooks/useMarketplaceCheckout/useMarketplaceCheckout.ts:337-351`); no buyer homeserver address path was found — **UNVERIFIED** as an absence claim           | Buyer and scripts in the buyer tab before submit; the command recipient/service; not public by this client contract                                                                                                                                                       |
| Saved delivery address                                                                | Buyer after successful checkout, when opting in | Account-scoped browser IndexedDB through `CommerceController.commitUpsertDeliveryAddress` (`src/hooks/useMarketplaceCheckout/useMarketplaceCheckout.ts:250-274`); the exact Dexie table name is **UNVERIFIED** | Buyer in that browser profile; browser/device attacker with IndexedDB access; not seller, homeserver, or service under the observed call path                                                                                                                             |
| Order delivery address                                                                | Checkout handler                                | `orders.delivery_address JSONB` in service PostgreSQL (`crates/service/migrations/0001_init.sql:87-102`); handler serializes and inserts it (`crates/service/src/handlers/checkout.rs:189-192,276-328`)        | Service operator/DB readers; checkout response initially includes `order.view()` (`crates/service/src/handlers/checkout.rs:400-405`), so buyer; ordinary order projections remove it (`crates/service/src/model.rs:356-367`), so seller does not receive it through reads |
| Order address in server model                                                         | Service DB reader                               | `OrderRow.delivery_address: Option<Value>` (`crates/service/src/model.rs:270-289`)                                                                                                                             | Any service code with `OrderRow`, including Shippo label flow; not public in `projection()`                                                                                                                                                                               |
| Shippo destination object                                                             | Service shipping endpoint                       | In process only while converting `order.delivery_address` to Shippo JSON (`crates/service/src/shipping.rs:477-512`)                                                                                            | Service process/operator at runtime and Shippo; seller receives quoted rates, not shown address in this code                                                                                                                                                              |
| Purchased shipping label metadata/URL                                                 | Service                                         | `orders.shipping_label` (`crates/service/src/model.rs:334-338`; update at `crates/service/src/shipping.rs:562-584`)                                                                                            | Seller-only label endpoint (`crates/service/src/shipping.rs:609-646`); Shippo label PDF/URL embeds the address by design; service operator can read its database                                                                                                          |
| Pasted packing-slip address                                                           | Seller                                          | React component state only; cleared on close, print completion, and route change (`src/hooks/usePackingSlipAddress/usePackingSlipAddress.ts:16-49`)                                                            | Seller tab and print/PDF destination; intentionally not the service, homeserver, or IndexedDB                                                                                                                                                                             |

`shipping_minor` is a price field, not address data: it is computed from seller-published shipping options in the service (`crates/service/src/homeserver.rs:233-295`) and stored on `orders` (`crates/service/src/model.rs:287-290`).

## B. Threat model

After this change, a valid address envelope protects plaintext from public readers, homeserver operators, marketplace-service operators, and a later compromise/export of the marketplace service DB. The service still sees metadata required to route the order: order UUID, buyer and seller pubkys, listing/line data, fulfillment, and the ciphertext length. It must not receive an address-derived shipping quote or any plaintext fallback.

Plaintext remains visible to the buyer while entering and retaining an address; to the seller after a successful client-side decrypt; to same-origin malicious script/extensions/XSS in either browser while plaintext or the seller private key is usable; to the browser/OS print subsystem and any print-to-PDF file; and to Shippo when a seller uses Shippo to quote or buy a label. This does not hide order existence, parties, purchase information, IP/network metadata, ciphertext timing/size, or the fact that Shippo was used. It does not make a malicious seller harmless: the seller is the intended recipient.

The seller delivery-key record is authenticated only by homeserver path ownership. A malicious or compromised seller homeserver (or any holder of a seller session grant covering the key path, including XSS in an origin holding a broad grant) can substitute the key document at fetch time and receive addresses sealed to it; TOFU pinning (§C) provides cross-order detection, not prevention. Separately, the envelope is unauthenticated at the crypto layer: the seller cannot prove to a third party that the buyer authored a ciphertext, the recipient can forge a valid envelope for an order it can read, and the buyer cannot prove which plaintext they sealed. Buyer authentication for the order is provided solely by the marketplace bearer session (`docs/ecommerce/status.md:25`); the service-stored envelope is the only committed evidence in a dispute.

Padding is mandatory and fixed: every plaintext is padded to exactly 1,024 bytes before sealing (§D), so every envelope has the same length and the ciphertext length leaks nothing beyond "a delivery address exists". An over-limit plaintext is rejected rather than truncated.

## C. Key model

### Decision: a seller-published delivery public key, private half device-bound

The seller's browser generates a random X25519 keypair (HPKE KEM keypair). It publishes a small public JSON record and keeps the private key wrapped in account-scoped IndexedDB using the existing non-extractable device-key AES-GCM wrapping (`src/libs/crypto/secret-wrapping.ts`, the pattern `messaging-keyring.ts` already uses for receiver key material).

Public record, one per seller, overwritten on rotation:

`pubky://{seller}/pub/pubky.app/marketplace/v1/delivery-keys/current`

```json
{
  "v": 1,
  "keyId": "<hex of first 16 bytes of SHA-256(publicKey)>",
  "publicKey": "<base64url, 32 bytes>",
  "createdAt": "<ISO 8601>"
}
```

`keyId` is derived, not chosen: the reader recomputes it from `publicKey` and rejects a mismatch, so there is no second field to forge.

**Where it lives, and why this is safe without Ring, Bitkit or homeserver changes.** The Shop already holds `/pub/pubky.app/:rw` and already writes Shop-owned public records under `/pub/pubky.app/marketplace/v1/` (`deliverables/`, `conversation-requests/`, `cli-grant-proofs/`). Writing one more record there needs no new path or capability. r4 asked for a separate narrower Ring capability; that would narrow the set of origins that can overwrite the record, but the residual risk it addresses (XSS or a malicious origin holding the broad grant swaps the key) is the same risk that already lets that origin rewrite the seller's listings and shop record, and the buyer-side pin below detects a swap after the first order. It is not a reason to block. A narrower grant is a later hardening, not a prerequisite, and no issue is opened against Ring or Bitkit for it. The one cross-repo effect is marketplace-nexus logging an unknown-resource error per key publish; a skip-prefix issue is filed against pubky/marketplace-nexus.

**Buyer pin (TOFU).** Account-scoped Dexie table `marketplace_delivery_key_pins`, one row per seller: `{sellerPubky, keyId, firstSeenAt}`. At checkout the buyer reads the record directly from the seller's homeserver (never through the service). First sight pins the key and shows its fingerprint. A different `keyId` than the pin blocks sealing until the buyer confirms the change in a dialog showing both fingerprints. J7: this friction is accepted.

**No key, no shipping checkout (J4).** A seller with no published key cannot sell shipped items. The buyer sees: "This seller has not set up encrypted delivery. Remove this shipping item or ask the seller to finish setup." Pickup and digital items are unaffected. The seller is told in the listing editor and in Get Paid → Delivery privacy. No plaintext fallback exists on the new client.

**Device-bound private key (J3).** The key lives on the device that generated it. Settings says so, and says that losing it means undelivered addresses cannot be opened (the buyer can re-send; the service holds nothing). Rotation generates a new keypair, republishes the record, and keeps old private keys locally so earlier orders still open. A multi-device backup follows the pattern of Shop #148 (wrap private data keys under the signer's scoped `e` key, homeserver #668) once Ring and Bitkit ship the `e` consent line (pubky-ring#385, pubky-passport#254, bitkit-ios#885, bitkit-android#1433, all open). Nothing in v1 depends on it.

### Rejected: derive an encryption key from Ring/Bitkit identity

No verified code path exposes an authorized X25519 derivation from the seller's Ed25519 identity secret to the Shop, and signing authority is not authority to repurpose the seed. Do not add a conversion scheme.

### Rejected: Paykit Noise Encrypted Link delivery

It needs an interactive XX handshake, both parties enrolled, and has no store-and-forward property (`docs/ecommerce/status.md`).

### Rejected: service-mediated escrow and service-held keys

The service's own sealing (`seal.rs` XChaCha20-Poly1305, `/priv` DEKs, pickup and digital seals) is opened by the service. Using it would break "stored only as ciphertext the service cannot open".

## D. Envelope and storage

### D1. Primitive choice (existing options, in the owner's order)

1. **Homeserver HPKE (#689, merged 12 Oct 2026, "encrypt grant approvals with HPKE"): the suite is chosen, the code is not reusable.** The stack's HPKE is RFC 9180 base mode, DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305. In the SDK it is `pub(crate)` (`approval_encryption.rs`) and `@synonymdev/pubky` exposes no HPKE function to JavaScript, so the Shop cannot call it. Nothing to import; the suite is what we adopt, so the whole stack speaks one HPKE.
2. **An audited library already in the dependency trees: not available for HPKE.** The Shop declares `@noble/curves`, `@noble/hashes` and `@noble/ciphers` (primitives, not a protocol; composing them is the hand-rolling the owner ruled out). There is no libsodium in the Shop tree, and libsodium sealed boxes use X25519 + XSalsa20-Poly1305 with a BLAKE2b nonce, a different construction from the stack's. The service has `chacha20poly1305` (it never decrypts this envelope).
3. **Vendored SB2/InboxKey: rejected.** `paykit-wasm-provenance.md` records that the app does not use the SB2 primitives; adopting them would bind addresses to a Paykit inbox key lifecycle the seller has not got, and it is a scheme with no published suite.

**Chosen:** RFC 9180 HPKE with the homeserver's suite, implemented by the standard `hpke-js` packages (`@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305`, pinned exact), the reference JavaScript HPKE implementation. The Rust side never seals or opens; the service validates only the byte length of the envelope. Interoperability with the Rust `hpke` crate (the one the homeserver uses) is proven by a vector test in the service repo (open with the Rust crate a vector sealed by hpke-js), so a future Rust client or the homeserver SDK can interoperate with no format change.

No custom key schedule, KDF, nonce handling or AEAD composition is written. HPKE's single-shot `seal` does key derivation, nonce and AEAD internally.

### D2. Envelope

One envelope per shipped order, sealed to the seller's current delivery public key:

- `info` = `"pubky-marketplace/delivery-address/v1"` (HPKE context separation).
- `aad` = `"pubky-marketplace/delivery-address/v1|" + checkoutCommandId + "|" + buyerPubky + "|" + sellerPubky + "|" + keyId`, UTF-8. `checkoutCommandId` is the client-generated v4 UUID the buyer already sends as the command id (lowercase hyphenated); the service persists it as `orders.checkout_command_id`. A ciphertext therefore cannot be replayed onto another checkout, buyer or seller, or after a key change. The seller recomputes the AAD from the order projection (command id, buyer, seller) and the envelope's `key_id`.
- Plaintext = canonical JSON of the address (the existing postal-address shape), UTF-8, at most 1,023 bytes, then `0x80`, then `0x00` bytes to exactly 1,024 bytes. After open, the seller strips from the last `0x80` and rejects if there is none or any later byte is non-zero.
- Wire bytes = `enc (32 bytes) || ciphertext (1,024 + 16 bytes)` = exactly 1,072 bytes, base64url without padding (1,430 characters). The service rejects any other length before storing.

No version byte inside the envelope: the field name (`delivery_address_envelope`) and the key record's `v` carry the version; a future suite is a new field.

The service never receives `info`, AAD inputs it does not already have, or any key. It cannot open the envelope.

Duplicate-`epk` rejection (r4) is dropped: HPKE generates a fresh ephemeral key per seal inside the library, which is the library's job, and a unique index on it would add a failure mode without a threat to answer.

## E. State machines and credential provenance

### Buyer

1. Address entered, validated locally; a saved address only fills the same form.
2. Seller key discovery: read `delivery-keys/current` directly from the seller's homeserver; reject absent, malformed, `keyId` mismatch or owner mismatch; apply the pin (§C).
3. Seal: per shipped seller group, with the command id that the checkout command will carry. Pickup and digital groups get no envelope. Plaintext is discarded after sealing.
4. Submit: `checkout.create` carries `delivery_address_envelopes`, one `{seller_pubky, key_id, envelope}` per shipped seller. Offer checkout carries `delivery_address_envelope` (`{key_id, envelope}`); the seller is the offer's seller. Drop claims go through checkout.
5. The marketplace bearer authenticates the request and is not part of any ciphertext.
6. A key change between fetch and submit: the service refuses nothing (it cannot know), the seller's decrypt fails (wrong key id), so the buyer re-fetches once immediately before sealing and the AAD binds the key id used.

### Seller

1. No key: shipping checkout unavailable (§C).
2. Order notification carries metadata only (existing rule).
3. Order view: the seller-only single-order projection returns `delivery_address: {format: "hpke_v1", key_id, command_id, envelope}` while the order is `paid` or `processing` and ships, and returns nothing else about the address. Buyers get neither.
4. Decrypt: look up the private key by `key_id`, rebuild the AAD, open, unpad. Unknown key id, authentication failure or malformed input is a hard stop: no guessed address, no Shippo call.
5. Packing slip and Shippo use the decrypted address held in component state only.
6. Shippo runs in the seller's browser against the Shippo API with the seller's own token (J1, §F).

Key provenance: the seller browser mints the keypair and writes the public half with the seller's session; the private half never leaves the device; the buyer reads the public half; the buyer browser mints the ephemeral key inside HPKE; the service stores and routes ciphertext and owns no decryption credential; Shippo receives plaintext only from the seller's browser.

## F. Service impact, migration, and rollout

- **Migration 0057** (claimed by this work; 0052-0055 are open upstream PRs, 0056 is the seller delivery terms PR): `orders.delivery_address_envelope BYTEA`, `orders.delivery_key_id TEXT`, a CHECK that they are set together and that a plaintext address and an envelope are never both present, and a one-time update that nulls `delivery_address` on every order already in `completed`, `cancelled`, `refunded_external` or `closed` (J2).
- Checkout and offer checkout accept either the legacy plaintext `delivery_address` or the envelopes, never both. A config flag `REQUIRE_ENCRYPTED_DELIVERY_ADDRESS` (default false until the Shop release is deployed, then true) refuses plaintext. A shipped group without an envelope is refused when the flag is on. The service validates, per envelope: seller is a shipped group's seller, one envelope per shipped seller, `key_id` is 32 lowercase hex characters, base64url decodes to exactly 1,072 bytes. Messages never echo the envelope.
- The order projection for the seller emits the `hpke_v1` shape above; legacy rows still emit `plaintext_v1` until purged. Redaction for buyers and everyone else is unchanged and tested to contain neither field.
- **Purge (J2):** a worker task on the existing `delivery_email_purge` pattern (lease, per-tick, summary counter) nulls `delivery_address`, `delivery_address_envelope` and `delivery_key_id` for orders in a final state: `completed`, `cancelled`, `refunded_external`, `closed`. It deletes at the final state, with no extra retention window; a window would be a config value if counsel asks for one.
- **Shippo (J1):** the service no longer calls Shippo. `shipping.rs`, its routes and its config go. The `shipping_configs` table and `orders.shipping_label` column stay because migrations are additive-only (`docs/migrations.md`); a later contract migration drops them. The seller's Shippo token and ship-from address move to device-local storage in the Shop. Labels and tracking: the Shop calls the Shippo API directly (CORS allows any origin with an Authorization header, checked 12 Oct 2026 with a preflight to api.goshippo.com) and records tracking through the existing ship command.
- No address-derived shipping quote (J6): checkout shipping is the seller's flat rate and needs no destination.

**Rollout, in order:** (1) service accepts both formats; (2) Shop ships the seller key lifecycle, decrypt and Shippo; (3) Shop ships buyer sealing; sellers without a key show the no-key message; (4) service flag turns plaintext off. Step 3 must not precede step 2.

## G. UX

Get Paid → Delivery privacy: create key (explains device custody, loss, rotation before generating), show fingerprint and date, rotate (loss warning). Cart: the interim copy ("Encrypting it to the seller's key is scheduled.") becomes "Encrypted to this seller's delivery key. The marketplace service cannot read it." once sealing ships. Key-change dialog shows both fingerprints. Seller decrypt failure: "This delivery address cannot be opened on this device. Do not ship yet. Restore the key that received this order or contact the buyer through the order conversation." The packing slip keeps the print-system warning. The Shippo settings panel says the token stays on this device.

## H. Self-attack table

| Attack                                                     | Control                                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Replay ciphertext onto another order, buyer, seller or key | AAD binds command id, buyer, seller, key id; open fails closed                                                                           |
| Downgrade to plaintext                                     | Flag refuses plaintext; DB CHECK forbids both fields; contract tests assert new rows hold null plaintext                                 |
| Service substitutes the key                                | Buyer reads the seller's homeserver directly; the record's `keyId` must match its key; the pin flags a change                            |
| Homeserver or broad-grant origin swaps the key             | Pin detects after first order; same trust as listings (§C); residual risk disclosed in §B                                                |
| Seller loses the key                                       | Device custody warning; safe stop; buyer re-send; no escrow                                                                              |
| XSS exfiltrates seller plaintext or key                    | Not protected against; minimize plaintext lifetime; CSP and dependency hygiene                                                           |
| Oversize or malformed envelope                             | Exact length 1,072 bytes, strict base64url, checked before storage                                                                       |
| Garbage ciphertext to burn a drop slot (J8)                | The existing claim window bounds an unpaid hold; a paid order the seller cannot open goes through the existing cancel request and refund |
| Seller falsely claims "cannot decrypt"                     | The stored envelope is the only evidence; disputes use the existing refund path                                                          |
| Legacy plaintext leak                                      | Sweep at migration, purge at final state, redaction tests                                                                                |
| Shippo token exposure                                      | Token never reaches the service; device-local only                                                                                       |

## I. Implementation slices (stacked, per repo)

Service: (1) migration 0057, payload contract, storage, projection, flag, hpke-js vector test; (2) purge worker; (3) remove server-side Shippo.
Shop: (1) this document; (2) envelope module, key lifecycle, pin; (3) sealing at checkout, offer checkout, drop claim; (4) seller decrypt and packing slip; (5) seller-direct Shippo.

Proof: real crypto in every test, no mocked seams; known-answer, tamper, wrong-AAD and wrong-key cases fail before any pass is accepted; the service opens a vector sealed by hpke-js with the Rust `hpke` crate. External audit (Kimi, full tier) is run by the Mac lane before review.

## J. Owner questions, closed 12 Oct 2026

| #   | Decision                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | Shippo stays, seller-direct from the seller's browser. The service never sees the address or the token.                                                                                                                                          |
| J2  | Purge at final state (completed, cancelled, refunded_external, closed), plus a one-time sweep of already-final legacy rows in migration 0057.                                                                                                    |
| J3  | v1 is device-bound. Backup follows Shop #148's `e`-key pattern once Ring and Bitkit ship consent for it.                                                                                                                                         |
| J4  | No published key, no shipping checkout for that seller. No plaintext fallback.                                                                                                                                                                   |
| J5  | Offer checkout is encrypted too. Auction orders hold no address.                                                                                                                                                                                 |
| J6  | No address-derived quote; no country code in the clear.                                                                                                                                                                                          |
| J7  | TOFU confirmation friction accepted.                                                                                                                                                                                                             |
| J8  | No new service state. An undecryptable envelope on an unpaid drop claim lapses with the existing claim window. Once paid, the seller uses the existing cancel request and the buyer's approval refunds it. Checkout stays rate-limited as today. |

## Changes from r4

- Primitive: hand-assembled X25519/HKDF/XChaCha20 replaced by RFC 9180 HPKE (§D1).
- Envelope, AAD and padding simplified (§D2); duplicate-`epk` rejection removed.
- Key record published by the Shop under its existing grant; no new capability (§C).
- Offers and drop claims in scope; Shippo seller-direct; legacy purge defined; J1-J8 closed.
