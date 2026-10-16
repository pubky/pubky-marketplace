# Store connections (WooCommerce, Shopify)

Where a seller connects a WooCommerce or Shopify store, chooses which store
products to also publish on Pubky, and sees whether Pubky orders reached the
store. The service side is the connector worker in `pubky-marketplace-service`
(`/v1/connectors`); this page is the Shop side.

## When the server has no connectors

Store connections are always shown: the dashboard has the button on every
environment and there is no Shop setting for it. The marketplace service has its
own: `CONNECTORS_ENABLED` is off unless set, and then every `/v1/connectors`
route answers `404 connectors_disabled` (a service older than the connectors has
no such route, a bare 404 or 405). The Shop reads either as "no connectors on
this server": the page says "Not available on this server yet" with a plain
sentence instead of an error or a toast, and the Orders page shows no push
status card and asks again only after ten minutes, so it is not refused on every
visit. Any other failure (a 503, a network error) is a load error that offers
Try again. The dashboard itself sends no connector request.

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
password fields, sent once over TLS to `PUT /v1/connectors/{id}/credentials`
(`{client_id, client_secret}` for Shopify, `{consumer_key, consumer_secret}` for
WooCommerce), and both fields are cleared from the form as soon as the call
returns, whether it worked or not. They are not kept in React
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

## Against the service contract

The Shop reads `internal/integrations/connector-contract.md` as written against
`pubky-marketplace-service` `connectors/routes.rs` (framework branch #132, plus
the Shopify stage 2 branch for the items marked stage 2). Connection fields it
relies on: `status` (`draft`, `connected`, `needs_attention`, `error`),
`app_kind`, `variant_mode` (stage 2), `scopes`, `missing_scopes`,
`credentials_saved`, `urls` (`launch` for Shopify, `oauth_callback`, `webhooks`),
`last_error`, `mapping_count`, `pushes`. A store that uninstalled the app or was
disconnected is not listed; the page shows the `store_uninstalled` alert instead.
A store whose keys were rejected stays listed with status `error`, and its card
says it needs attention. The push status card on the orders page appears for
every listed store that is not a draft, because pushes keep running while a store
needs attention.

Stage 2: `PUT /settings` (`variant_mode`), `GET /check` (store name, granted
scopes, locations) and the `action` on store-side cancel and refund alerts. An
alert action is a link into the order (`/marketplace/orders#order-<id>`), where
the existing approve-cancellation or record-refund step is; the Shop never
cancels or refunds for the seller.

Switching a connection to "One listing per size or variant" (`split`) answers
`PUT /settings` with `unmapped_listings` (`[{listing_id, mappings_removed}]`):
the listings that combined several store variants and were unlinked in the same
step. The page shows them at once ("These listings were combined, so they're no
longer linked. Re-import them from the catalog or end them."), each as a link to
the listing, with a link to the catalog; the service does not refuse the switch
any more (`409 mappings_conflict` is gone), and the same listings also arrive as
a `listings_unmapped` alert. `variant_mapping_error` (a store stock change named
a variant Pubky cannot address) shows "A size in your store no longer matches a
Pubky listing. Re-link the product to keep its stock in sync." with a link to
that connection's catalog; its detail names the listing only as free text, so
the Shop does not parse it.

These alert kinds carry no action and no retry, only plain copy and Dismiss
(`listings_unmapped` and `variant_mapping_error` also link to the catalog):
`refund_reversed_after_mirror` (a refund Pubky mirrored to the store was later
reversed or reduced; the seller corrects it in the store), `push_total_mismatch`
(the store created the order with a different total than the buyer paid) and
`listings_unmapped` (switching to one listing per variant unlinked combined
listings; import each variant again or end the combined listing). An unknown
alert kind shows generic copy.

Where the Shop still differs from the service, and what it does:

- **Pasted WooCommerce keys** work. `PUT /v1/connectors/{id}/credentials` takes
  `{consumer_key, consumer_secret}` for a WooCommerce draft (service PR #135,
  confirmed at head `c32fd03`), checks the pair against the store, connects it
  and answers `connector_connected` with the connection; the Shop reads that
  answer like the `connector_credentials` one a Shopify save returns. Refusals
  are explained by code: `invalid_keys`, `credentials_rejected`,
  `keys_read_only`, `not_pending` (the draft expired, or the store is already
  connected) and `shop_in_use`. A refused attempt does not leave a draft
  behind: the Shop deletes the draft it just created, and the service deletes
  drafts whose connect fails. The service takes keys only for a draft, so
  Replace credentials on a store that is already connected answers
  `not_pending`; the message tells the seller to disconnect it and connect
  again.
- **Install from the Shop.** The launch URL needs Shopify's own signature, so the
  Shop cannot start the install. The guide's Install button opens the Dev
  Dashboard, and the step says to use the app's Home, Install app.
- **Privacy webhooks.** Shopify's three privacy topics can only be set in the
  app, so step 4 shows the webhooks URL for them. The wording of this note is
  approved (C21/SH2) as written.
- **WooCommerce.** The connect domain is sent as `host[/path]`, the returned
  approval link must be on that host, and the return is `?success=1|0`; the
  service contract does not state these.
- **Catalog.** Every product has at least one variant, and `provider_variant_id`
  is the id the store's webhooks and orders use.
