# Inventory CSV import and export

The seller dashboard's **Export CSV** button and the inventory importer share
one format: the canonical import CSV defined by `@bitcoinerrorlog/pubky-shop`
(`CANONICAL_CSV_COLUMNS`). A file exported from the dashboard can be edited in
a spreadsheet and imported back, and an unedited export plans zero changes.

## Export

`MarketplaceDashboard` → `useMarketplaceSellerDashboard().exportCsv()` →
`CommerceController.exportInventoryListingsCsv(sellerPubky)` →
`CommerceInventoryImportApplication.exportListingsCsv`.

- Source of rows: the seller's listings from the marketplace service
  (paginated, needs the inventory capability token). When the token is missing
  or the service call fails, the export falls back to the locally cached
  listing records (`host.localRecords()`), so the button always exports what
  the dashboard shows.
- One CSV row per variant (every listing record has at least one variant).
- Output is the SDK's `exportCanonicalCsv` bytes (UTF-8, CRLF row separators)
  downloaded as `pubky-marketplace-inventory.csv`.

### Columns

Before (removed, lossy 7-column summary the importer could not read):
`listing_id,title,state,format,price_minor,currency,inventory`

After (canonical, 25 standard columns plus two extras):

| Group       | Columns                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `record_uri`, `seller_pubky`, `listing_id`, `source_listing_key`, `record_revision`                                                   |
| Variant     | `variant_id`, `sku`, `variant_quantity`, `variant_enabled`, `options_json`                                                            |
| Listing     | `state`, `title`, `description`, `taxonomy_json`, `category`, `condition`, `tags_json`                                                |
| Price       | `amount_minor`, `currency`, `exponent` (canonical minor units; `sale_json` carries the full sale incl. auctions, quotes and formulas) |
| Media       | `media_json` (media references: id, `pubky://` URL, content hash, type)                                                               |
| Fulfillment | `shipping_options_json`, `return_policy_json`                                                                                         |
| Other       | `sale_json`, `external_refs_json`                                                                                                     |
| Extras      | `record_json` (the full listing record, used to restore fields that have no column), `country_code`                                   |

## Import and the round trip

`planBrowserFile` parses the CSV, hashes each normalized row and compares it to
the seller's existing records:

- Rows whose hash matches the stored record are `unchanged`.
- When `record_json` is present, the editable columns (title, description,
  state, category, condition, tags, variants, SKU, quantity, enabled flag,
  options, sale price, shipping options, return policy) are overlaid on the
  embedded record, so spreadsheet edits take effect. If the overlay changes
  nothing, the record keeps its revision; otherwise the revision is bumped by
  one and `updatedAt` is refreshed, producing exactly one planned update per
  edited listing.
- Multi-line text is written with CRLF inside quoted cells because the SDK's
  streaming parser rejects bare LF in quoted fields; the importer converts it
  back to LF.

Covered by `src/core/application/commerce/inventory-export-roundtrip.test.ts`
(12 fixture listings: variants and SKUs, auctions, quotes/formulas, emoji and
multi-line text, digital delivery, BTC assets, video media, varied shipping
and return policies):

1. export N listings → plan → `unchanged: N`, no creates/updates/conflicts;
2. edit one exported row → exactly one planned update that publishes cleanly.

## Limitations

- **Photos and videos are references, not bytes.** `media_json` keeps the
  media ids, `pubky://` URLs and hashes, so re-importing the seller's own
  export reattaches the same files. Importing the file into a different
  account does not copy the media; the files stay on the original homeserver.
- Editing `record_json` directly is unsupported; edit the typed columns.
- Hand-authored CSVs without `record_json` keep the previous behavior and must
  provide `media_json` (or the standard media column) for every listing.
- No separate summary export exists; the dashboard has no use for one.
