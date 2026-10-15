# WooCommerce product CSV fixtures

## `sample_products.csv`

WooCommerce's official sample product export, committed byte for byte.

- Source: <https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/sample-data/sample_products.csv>
- Raw: <https://raw.githubusercontent.com/woocommerce/woocommerce/trunk/plugins/woocommerce/sample-data/sample_products.csv>
- Last commit that changed the file: `9e62fb58b8ee0c4bb888262e462cbae6fc7c4fdc` (2022-05-19, "Updating references to old album-1 image")
- `trunk` head when fetched (2026-10-15): `d427a0b14fa9d7979120e939ff5c96dd2900f436`
- SHA-256 of the committed bytes: `1d6f48b6f33fdc04615a9722c59f8cb8a07ed62e94a1dc3237313983d1884721`
- License: GPL-2.0-or-later, as the WooCommerce repository. It is sample data (25 products); no personal data.

The file already starts with a UTF-8 BOM and uses `,` delimiters. It has simple, variable and variation rows (linked by
`Parent` SKU), a grouped product, an external product and two downloadable virtual products.

## `sample_products.semicolon-bom.csv`

The same rows re-written with `;` delimiters, CRLF row ends and a UTF-8 BOM, the way a European spreadsheet locale saves
the export. Generated from `sample_products.csv` with Python's `csv` module (`delimiter=';'`, `lineterminator='\r\n'`,
`encoding='utf-8-sig'`); no cell values were changed.
SHA-256: `bd4d2f9ad5f3e168b61c0a0a4b8eacc46c0c57e21d241fafbde82f9d939533cf`.

## `dezentralshop-woo-export-2026-10-15.csv`

A real WooCommerce product export from the Dezentralshop (dezentralshop.ch), committed byte for byte.

- Source: the merchant's attachment on [issue #226](https://github.com/pubky/pubky-marketplace/issues/226), downloaded 2026-10-15.
- Contents: public catalogue data only (product names, descriptions, prices in CHF, stock counts, public image URLs on
  dezentralshop.ch); nothing private. The merchant attached it for this purpose.
- SHA-256: `d71e0e3c9c416872102dac8b5b10bbec032472185c225ca98bd052b0919588de`.
- UTF-8 with BOM, `,` delimiters, **German column headers** (`Typ`, `Artikelnummer`, `Regulärer Preis`, …), 30 rows:
  10 `variable`, 18 `variation`, 2 `simple`. `Übergeordnetes Produkt` (Parent) holds the parent's SKU, five variable
  products have no variation rows, variation names contain `<span> - </span>`, variations have no `Bilder`, and one
  simple product is in stock with an empty `Bestand`.
- Two of its headers (`Geringe Lagermenge`, `Rückstände erlaubt?`) are older WooCommerce wording that today's German
  translation no longer contains; the importer's header table keeps them as aliases because this file proves WooCommerce
  emitted them.

## Header translations

`src/core/pipes/commerce/import-woo-headers.ts` maps localised Woo headers (en, de, fr, it) to the English names. Every
label is pinned to its English msgid by `import-woo-headers.translations.test.ts`, using
`woocommerce-po-extract.json`: only the msgid/msgstr pairs the table maps, with the source of each side.

- Translations: GlotPress project "Plugins - WooCommerce - Stable (latest release)", exported as PO from
  `https://translate.wordpress.org/projects/wp-plugins/woocommerce/stable/{de,fr,it}/default/export-translations/?format=po`
  on 2026-10-15. PO-Revision-Date: de 2026-10-14 19:02:42+0000, fr 2026-10-07 19:07:09+0000, it 2026-10-07
  19:08:14+0000. SHA-256 of each full file is in the extract (de `67dff03d4861b440…`, fr `c1a95cfd13719a04…`, it
  `b3f431e68f8f3fde…`). The 3 MB PO files are not committed.
- English msgids: the exporter's own strings in WooCommerce 11.2.1 (the stable release),
  `plugins/woocommerce/includes/export/class-wc-product-csv-exporter.php` (file last changed in commit
  `5938a201befb81662baa4913614d32758bd25027`, 2026-09-11): `get_default_column_names()` and the numbered download,
  attribute and Meta columns. The extract records the source line of each msgid.
- Not in the table: WooCommerce `trunk` (not yet released) adds the columns "Commodity code (HS code)", "Country of
  origin" and "Customs description". They have no stable translation yet; a file that carries them reports them as
  unrecognised columns and is otherwise read normally.
- Two German headers in the Dezentralshop file are older wording that today's translation no longer has; they stay as
  aliases (see above) and the test requires that the real file contains them.
