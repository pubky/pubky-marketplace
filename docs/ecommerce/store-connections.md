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
`useConnectorCatalog`, `useConnectorPushStatus`, `useConnectorChanges`,
`useConnectorSync`, `useListingStoreSync`) → organisms. Wire shapes,
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
- **One listing per size or variant** (the connection's `variant_mode`, shown in
  its settings). `native` keeps a product's variants together as one listing.
  `split` makes each store variant its own listing with a single variant, titled
  with its choice ("Socks bundle, Size M"), and links each to its own store
  variant. Listing ids are `woo-<product>-<variant>`, so changing the mode later
  publishes new listings; it applies to products published from then on.
- A re-import of a listing that is already live is never paused by a publish
  gate (C16): it stays live, its content is updated and the dry run and the
  result file say "kept live". New listings and listings already paused save
  paused. This is lane A's import behaviour, and `inventory-import.connector.test.ts`
  proves it for connector rows, native and split.
- Listing ids are stable (`woo-<store id>`, `shopify-<store id>`), so importing a
  product again is an update, not a second listing.
- After the publish the listings are linked to their store variants
  (`PUT /v1/connectors/{id}/mappings`, merged with the existing set). The service
  holds only listings whose publish finished, so a listing it names as missing
  (`listing_not_found`) is left out and the rest is written. Without the link,
  stock does not follow the store and a Pubky order for the listing is held back
  as `unmapped_variant`. The link runs after a publish or a resume even when that
  stops with an error, so listings that were already synced are still linked; if
  the link itself fails the page says the listings are published but not linked
  and offers "Link again".

Currencies other than USD and BTC can be listed only after the multi-currency
listing form (PR #235) is in; until then a CHF store stops at the settings step
with a message.

## Product sync (Shopify)

A listing linked to a store product can follow the store for three groups:
**content** (title, description and photos), **price** (each variant's price) and
**variants** (option choices, SKU, and which variants exist). Stock is not a group:
it already follows the store through the service's inventory sync. A product the
store stops selling pauses its listing whatever the settings say, because an order
for it could not reach the store.

It is behind `PUBKY_RUNTIME_STORE_SYNC_ENABLED` (default `false`). Off, the Store
connections page shows neither the review nor the Sync table, the listing editor
shows every field editable, and the Shop applies nothing. The service queues store
changes either way; see "Product changes" in the marketplace service's
`docs/api.md` for its routes and the base and proposal it keeps per group.

### Where it shows

- **Sync table** (Store connections, under each connected Shopify store): one row
  per group, **From your store** or **Off**. The default for all three is from
  the store. Saving a row drops that group's pending changes in the service, so
  the review reads them again; a change reviewed under the old setting can never
  apply under the new one. `useConnectorSync` reads and saves it
  (`GET`/`PUT /v1/connectors/{id}/sync`).
- **Shopify changes (N)** (Store connections, above the Sync table): the changes
  that wait for the seller. `useConnectorChanges` loads them
  (`GET /v1/connectors/{id}/changes`) and the organism
  `MarketplaceConnectorChanges` lists them. Nothing is listed when there are none.
- **Follow switch** (listing editor, for a listing linked to a Shopify store): one
  per group and per linked store. On, the group follows the store: its fields are
  read-only, with "Edit in Shopify" (only for a real `*.myshopify.com` store), so a
  store edit never collides with one made here. Off, the group is not synced for
  this listing. The switch shows what applies to the listing; the line under it says
  whether that is the connection's setting or the listing's own. Turning it
  changes only this listing, to the opposite of the connection's setting
  (`PUT /v1/connectors/{id}/sync/listings/{listing_id}`, `null` returns to the
  connection's setting), so a listing can opt in for a group the connection leaves
  alone. A group counts as followed when any store the listing is linked to says so.
  `useListingStoreSync` finds the linked stores from the connection mappings.
  Stock stays editable.
- **What a followed field cannot do.** Read-only fields are also enforced on save:
  the saved record takes a followed group's values from the published record,
  whatever the form holds (`src/core/pipes/commerce/listing-followed-fields.ts`).
  A listing whose variants follow the store keeps its own variants, ids and
  disabled ones, and takes only stock from the form (and each variant's price
  override while price does not follow); photos are not uploaded and dropping files
  does nothing. While variants or prices follow the store, variants cannot be added
  or removed in the editor, because each variant's price is paired with the
  published variant. The save is held until the linked stores have been asked: a
  server with no store connections or a missing marketplace session ends the lookup
  with nothing followed, any other failure keeps the save held with "Try again".
  When a group follows the store again after being edited here, its fields go back
  to the published values (all variant rows, if a row was removed).

### What applies when

The Shop applies a change because only the seller's Shop can sign a listing write.

| Change                                                                                                 | When the page opens                | Needs a tap                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------- |
| Title, description, photos                                                                             | applied                            | only a conflict            |
| A product the store no longer sells                                                                    | listing paused, even with sync Off |                            |
| Price                                                                                                  |                                    | Apply price                |
| Option choices, SKU, a variant the store removed (the listing price is rebuilt from the variants left) |                                    | Apply                      |
| Making a paused listing active again                                                                   |                                    | Make active                |
| A variant the listing has no link to                                                                   |                                    | Import it (catalog import) |

### The three-way rule

`src/core/pipes/commerce/connector-change-apply.ts` (pure) decides, per field, from
the listing's value, the service's `base` (what the store held when the listing last
followed it) and the `proposed` value:

- the listing already equals the proposal: nothing to do;
- the listing equals the base: the seller has not touched it, so the proposal
  applies;
- otherwise both sides changed it: a **conflict**. Nothing moves until the seller
  picks **Use the store's** (apply the proposal), **Keep mine** (resolve the change
  as dismissed) or **Stop following the store for this listing** (set that group
  Off for the listing).

A change with no base cannot tell, so it conflicts. Photos are a set, not a value:
a photo the store added or removed is merged one by one, and a photo the seller
removed stays removed while the store still has it, so photos never conflict. A
listing holds at most 12 photos: when store photos find no room, the rest of the
change applies and the change stays in the review with the reason until the seller
removes a photo or dismisses it, instead of being resolved as done. A change that would leave the listing without an image (a
video does not count) is refused. Photos go through the import's photo phase
(`runImportImageBatches`): fetched through the server route, stripped of metadata
and uploaded to the seller's homeserver, never referenced by the store's address.

Mapping details: the title and description follow the import's rules (plain text,
the title limit, the title standing in for an empty description; a store
description of `null` leaves the listing's). A price changes the listing price and
each linked variant's price, with the lowest as the listing price and the others
as price overrides, as the import writes them; it is refused, with the reason, for
an auction, a currency other than the listing's (nothing is converted), a price
that does not fit the listing's decimals, or a price of zero. A link the listing
cannot use (no link, a blank store or listing variant id, or only links to variants the
seller deleted) is refused as an incomplete link instead of being read as an empty
change. A removed store variant is turned off, the listing price is rebuilt from
the variants left, and the listing is paused when no enabled variant with stock is
left. Every result is checked against the listing record schema before it is
written; a change the listing cannot hold is refused with that reason and can be
dismissed.

### Applying is safe to repeat

For each change the Shop reads the changes again (a proposal replaced or withdrawn
since the list was read is not applied), reads each listing again from the
homeserver and evaluates it, reads the changes once more immediately before each
write (photo uploads can take a while, and the seller may have switched the group
off meanwhile), writes the listing with `commitUpsertListing`, reads the write back,
and only then resolves the change as `applied` with the proposal hash it acted on.
A write counts as confirmed only when the homeserver serves back that exact
revision and timestamp; a newer revision written elsewhere leaves the change
pending. A change that looks already done is settled only from what the homeserver
serves, never from the Shop's local copy, which may hold a write the homeserver
never took. A listing that already equals the proposal is only resolved, so a retry
after a crash writes nothing twice. A write the homeserver has not served back yet
leaves the change pending ("has not confirmed the update yet") until the revision
shows. A resolve answered `change_stale` or `change_not_found` is not an error: the
Shop reads the changes again. A change whose every listing is switched off or gone
has nothing to apply and is dismissed. A change that looks done but cannot be
confirmed against the homeserver yet stays pending and is counted in the review
("could not be checked yet", with Try again). If some photos fail to load, the listing
keeps the ones that loaded and the change stays pending with the reason; the next
try loads only the missing ones, and photos already uploaded in the same visit are
reused.

Residuals: the service has no conditional write, so a group switched off in the
single request between the last check and the write can still see that one write;
the change is then answered `change_not_found` and the seller sees the listing as
written. A photo whose upload finished but whose listing write did not, when the
page is closed in between, leaves a file nothing refers to; the retry uploads it
again and the listing references one copy.

### Where it runs

The auto-applied groups run when the Store connections page opens (and on "Try
again" or after a direction change). They do not run in the background: a service
that wrote to the seller's homeserver would be publishing for them, which needs a
write grant the Shop does not issue.

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
- **Linking.** The Shop relies on `error.listing_id` on `422 listing_not_found`
  (the contract names it) to leave one unfinished listing out of the link.
