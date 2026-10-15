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

`src/core/pipes/commerce/import-woo-headers.ts` maps localised Woo headers (en, de, fr, it) to the English names. The
strings come from WooCommerce's own translations on translate.wordpress.org, exported 2026-10-15:
`https://translate.wordpress.org/projects/wp-plugins/woocommerce/stable/{de,fr,it}/default/export-translations?format=po`
(project "WooCommerce - Stable (latest release)"), for the msgids the exporter uses in `get_default_column_names()` and
its numbered attribute and download columns (`includes/export/class-wc-product-csv-exporter.php`, last changed in
commit `0a0b4b2cfc40dfdfd7e36966e136729b05c6402d`, 2026-10-06).
