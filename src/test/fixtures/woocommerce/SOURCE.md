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
