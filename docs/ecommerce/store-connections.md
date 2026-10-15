# Store connections (WooCommerce, Shopify)

Where a seller connects a WooCommerce or Shopify store, chooses which store
products to also publish on Pubky, and sees whether Pubky orders reached the
store. The service side is the connector worker in `pubky-marketplace-service`
(`/v1/connectors`); this page is the Shop side.

## Pages

- `/marketplace/settings/store-connections` lists the connections (Connected,
  Needs attention with the reason, Disconnected), Replace credentials and
  Disconnect, then the connect flows. It is also the page the service sends the
  seller back to after an install (`CONNECTOR_RETURN_URL`).
- `/marketplace/settings/store-connections/[connectionId]` is the catalog: the
  store's products, search, and an "Also publish on Pubky" checkbox per product.
- Orders shows "Orders in your store" for a seller with a connected store: each
  sale's push state, the orders that were not sent with the reason and Retry,
  and store alerts (a store-side cancel asks the seller to cancel and refund in
  Pubky; nothing is refunded automatically).

## Layers

`MarketplaceConnectorsService` (service client) → `ConnectorsApplication` →
`ConnectorsController` → hooks (`useStoreConnections`, `useConnectWooCommerce`,
`useConnectShopify`, `useReplaceStoreCredentials`, `useConnectionStatusCheck`,
`useConnectorCatalog`, `useConnectorPushStatus`) → organisms. Wire shapes,
copy and the pure helpers are in `src/libs/commerce/connectors.ts`.

## Credentials

A Shopify Client ID and secret and a WooCommerce key and secret are typed into
password fields, sent once over TLS to `PUT /v1/connectors/{id}/credentials`, and
cleared from the form as soon as the call returns. They are not kept in React
state beyond the form, Dexie, localStorage, sessionStorage or a store, and no
request body is put in an error context or a log line. The service never returns
them.

## WooCommerce

The seller enters the store address. `POST /v1/connectors` returns the store's
`/wc-auth/v1/authorize` URL, which must be on the same host the seller typed
(anything else is refused). The seller approves on their own store and comes back
with `success=1` (or `0`); the page then runs the status check, which looks a few
times because WooCommerce posts the keys to the service from its own server. The
fallback is a pasted REST key pair (`ck_`/`cs_`), for stores that block the
approval screen.

## Shopify

Until the public app is approved, each merchant creates their own Dev Dashboard
app. The guide creates a draft connection (`POST /v1/connectors`), shows its
per-connection URLs and the exact scopes with copy buttons, takes the Client ID
and secret, sends the merchant to install, and runs the status check (store
name, permissions granted, locations, a test catalog read). A missing scope shows
as Needs attention with the scope names. Steps have a picture slot each: drawn
illustrations now, screenshots as soon as `config/shopify-guide.ts` has entries.

## Publishing the chosen products

"Publish chosen products" on the catalog page reads the saved choice
(`GET /v1/connectors/{id}/catalog?selected=true`, every page) and maps those
products to the same canonical rows the CSV presets produce
(`src/core/pipes/commerce/connector-catalog-rows.ts`, pure). The rows go through
the Studio's own import, `useMarketplaceInventoryImport`, unchanged: plan,
dry-run, photos, publish gates and result file. Rules:

- No silent shipping default: the settings step asks for ships-from and shipping,
  filled from the shop location and the seller's latest listing when they have
  them, with one click for free shipping. A listing carries neither until chosen.
- Prices stay in the store's currency and are never converted; a product in
  another currency, with a zero price or with too many variants is skipped and
  reported.
- A variant whose stock the store does not track gets the seller's default
  quantity and the note "Stock unknown, set to N".
- Listing ids are stable (`woo-<store id>`, `shopify-<store id>`), so importing a
  product again is an update, not a second listing.
- After the publish the listings are linked to their store variants
  (`PUT /v1/connectors/{id}/mappings`, merged with the existing set). The service
  holds only listings whose publish finished, so a listing it names as missing
  (`listing_not_found`) is left out and the rest is written. Without the link,
  stock does not follow the store and a Pubky order for the listing is held back
  as `unmapped_variant`.

Currencies other than USD and BTC can be listed only after the multi-currency
listing form (PR #235) is in; until then a CHF store stops at the settings step
with a message.

## Against the service contract

The Shop reads `internal/integrations/connector-contract.md` as written against
`pubky-marketplace-service` `connectors/routes.rs` (framework branch #132, plus
the Shopify stage 2 branch for the items marked stage 2). Connection fields it
relies on: `status` (`draft`, `connected`, `needs_attention`, `error`),
`app_kind`, `variant_mode` (stage 2), `scopes`, `missing_scopes`,
`credentials_saved`, `urls` (`launch` for Shopify, `oauth_callback`, `webhooks`),
`last_error`, `mapping_count`, `pushes`. A store that uninstalled the app or was
disconnected is not listed; the page shows the `store_uninstalled` and
`credentials_rejected` alerts instead.

Stage 2: `PUT /settings` (`variant_mode`), `GET /check` (store name, granted
scopes, locations) and the `action` on store-side cancel and refund alerts. An
alert action is a link into the order (`/marketplace/orders#order-<id>`), where
the existing approve-cancellation or record-refund step is; the Shop never
cancels or refunds for the seller.

Where the Shop still differs from the service, and what it does:

- **Pasted WooCommerce keys.** `PUT /credentials` answers
  `422 credentials_not_supported` for WooCommerce. The Shop still sends
  `{consumer_key, consumer_secret}` (the fallback of plan section 10) and says
  so in plain words; it works as soon as the WooCommerce stage accepts them.
- **Install from the Shop.** The launch URL needs Shopify's own signature, so the
  Shop cannot start the install. The guide's Install button opens the Dev
  Dashboard, and the step says to use the app's Home, Install app.
- **Privacy webhooks.** Shopify's three privacy topics can only be set in the
  app, so step 4 shows the webhooks URL for them (new text, not in the approved
  copy).
- **WooCommerce.** The connect domain is sent as `host[/path]`, the returned
  approval link must be on that host, and the return is `?success=1|0`; the
  service contract does not state these.
- **Catalog.** Every product has at least one variant, and `provider_variant_id`
  is the id the store's webhooks and orders use.
- **Linking.** The Shop relies on `error.listing_id` on `422 listing_not_found`
  (the contract names it) to leave one unfinished listing out of the link.
