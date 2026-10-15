import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { csvHeaderCells, parseCsvTable } from './import-csv-table';
import { summarizeLossReport } from './import-loss-report';
import { SOURCE_IMAGE_URLS_FIELD, VARIANT_PRICE_MINOR_FIELD } from './import-preset-rows';
import { type ImportSettings } from './import-settings';
import { isWooProductCsv, mapWooProductCsv, type WooMapResult } from './import-woo-csv';

const SELLER = 'y'.repeat(52);
const NOW = new Date('2026-10-15T12:00:00.000Z');
const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

function map(text: string, settings: ImportSettings = IMPORT_SETTINGS_COMPLETE): WooMapResult {
  const parsed = parseCsvTable(text);
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.reason}`);
  return mapWooProductCsv({ table: parsed.table, sellerPubky: SELLER, settings, now: NOW });
}

const HEADER =
  'ID,Type,SKU,Name,Published,Short description,Description,Date sale price starts,Date sale price ends,In stock?,Stock,Sale price,Regular price,Categories,Tags,Images,Parent,Attribute 1 name,Attribute 1 value(s),Attribute 2 name,Attribute 2 value(s)';

function csv(...lines: string[]): string {
  return `${HEADER}\n${lines.join('\n')}\n`;
}

function codes(result: WooMapResult, code: string) {
  return result.report.losses.filter((loss) => loss.code === code);
}

describe('isWooProductCsv', () => {
  it('needs Type, SKU and Regular price, whatever the case, BOM or delimiter', () => {
    expect(isWooProductCsv(['ID', 'Type', 'SKU', 'Name', 'Regular price'])).toBe(true);
    expect(isWooProductCsv(['type', 'sku', 'regular PRICE'])).toBe(true);
    expect(isWooProductCsv(csvHeaderCells(fixture('sample_products.csv')))).toBe(true);
    expect(isWooProductCsv(csvHeaderCells(fixture('sample_products.semicolon-bom.csv')))).toBe(true);
    expect(isWooProductCsv(['Title', 'URL handle', 'SKU', 'Price', 'Type'])).toBe(false);
    expect(isWooProductCsv(['record_uri', 'sku'])).toBe(false);
  });
});

describe('WooCommerce official sample_products.csv', () => {
  const result = map(fixture('sample_products.csv'));

  it('imports every simple and variable product and skips grouped and external with a reason', () => {
    expect(result.report).toMatchObject({ listingsRead: 18, listingsImported: 16, listingsSkipped: 2 });
    const skipped = codes(result, 'unsupported_type');
    expect(skipped.map((loss) => loss.listing)).toEqual(['Logo Collection', 'WordPress Pennant']);
    expect(skipped.every((loss) => loss.severity === 'skipped' && loss.line !== undefined)).toBe(true);
    expect(new Set(result.rows.map((row) => row.listingId)).size).toBe(16);
    expect(result.rows).toHaveLength(21);
  });

  it('turns a variable product and its variations into one listing with option values', () => {
    const tee = result.rows.filter((row) => row.listingId === 'woo-vneck-tee');
    expect(tee.map((row) => row.variantId)).toEqual(['woo-vneck-tee-red', 'woo-vneck-tee-green', 'woo-vneck-tee-blue']);
    expect(tee.map((row) => row.options)).toEqual([{ Color: 'Red' }, { Color: 'Green' }, { Color: 'Blue' }]);
    const hoodie = result.rows.filter((row) => row.listingId === 'woo-hoodie');
    expect(hoodie.map((row) => row.options)).toEqual([
      { Color: 'Red', Logo: 'No' },
      { Color: 'Green', Logo: 'No' },
      { Color: 'Blue', Logo: 'No' },
      { Color: 'Blue', Logo: 'Yes' },
    ]);
    expect(new Set(tee.map((row) => row.title))).toEqual(new Set(['V-Neck T-Shirt']));
    expect(tee[0]?.sku).toBe('woo-vneck-tee-red');
  });

  it('carries no revision, so a re-import is an update and never a conflict', () => {
    expect(result.rows.every((row) => row.recordRevision === null)).toBe(true);
  });

  it('prices the listing at its lowest variation and overrides the dearer variants', () => {
    const tee = result.rows.filter((row) => row.listingId === 'woo-vneck-tee');
    expect(tee.map((row) => row.amountMinor)).toEqual([1_500, 1_500, 1_500]);
    expect(tee.map((row) => row.extraFields[VARIANT_PRICE_MINOR_FIELD])).toEqual(['2000', '2000', undefined]);
    const hoodie = result.rows.filter((row) => row.listingId === 'woo-hoodie');
    // Red hoodie: regular 45, sale 42. The sale price wins and sets the listing price.
    expect(hoodie[0]?.amountMinor).toBe(4_200);
    expect(hoodie.map((row) => row.extraFields[VARIANT_PRICE_MINOR_FIELD])).toEqual([
      undefined,
      '4500',
      '4500',
      '4500',
    ]);
    expect(result.rows.every((row) => row.currency === 'USD' && row.exponent === 2)).toBe(true);
  });

  it('uses the sale price when set, else the regular price', () => {
    const price = (listingId: string) => result.rows.find((row) => row.listingId === listingId)?.amountMinor;
    expect(price('woo-beanie')).toBe(1_800);
    expect(price('woo-belt')).toBe(5_500);
    expect(price('woo-cap')).toBe(1_600);
    expect(price('woo-sunglasses')).toBe(9_000);
    expect(codes(result, 'compare_at_price')).toHaveLength(7);
  });

  it('reads In stock? without a count as the unmanaged default and reports it', () => {
    expect(result.rows.every((row) => row.variantQuantity === 1)).toBe(true);
    expect(codes(result, 'stock_unmanaged')).toHaveLength(21);
    const more = map(fixture('sample_products.csv'), { ...IMPORT_SETTINGS_COMPLETE, unmanagedStock: 5 });
    expect(more.rows.every((row) => row.variantQuantity === 5)).toBe(true);
  });

  it('carries categories, publishes active, and applies the settings to every row', () => {
    const polo = result.rows.find((row) => row.listingId === 'woo-polo');
    expect(polo).toMatchObject({
      state: 'active',
      category: 'Clothing > Tshirts',
      condition: 'new',
      returnPolicy: { accepted: false },
    });
    expect(result.rows.every((row) => row.extraFields.country_code === 'US')).toBe(true);
    expect(result.rows[0]?.shippingOptions).toEqual([
      { id: 'standard', pricing: 'free', label: 'Free shipping', estimatedMinDays: 3, estimatedMaxDays: 10 },
    ]);
    expect(
      result.rows.every(
        (row) => JSON.stringify(row.shippingOptions) === JSON.stringify(result.rows[0]?.shippingOptions),
      ),
    ).toBe(true);
  });

  it('keeps the image URLs in the row and reports them as not loaded', () => {
    const tee = result.rows.find((row) => row.listingId === 'woo-vneck-tee');
    const images = JSON.parse(tee?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as { url: string; alt: string }[];
    expect(images.map((image) => image.url)).toEqual(
      expect.arrayContaining([
        'https://woocommercecore.mystagingwebsite.com/wp-content/uploads/2017/12/vneck-tee-2.jpg',
        'https://woocommercecore.mystagingwebsite.com/wp-content/uploads/2017/12/vnech-tee-green-1.jpg',
      ]),
    );
    expect(images.every((image) => image.alt === 'V-Neck T-Shirt')).toBe(true);
    expect(tee?.media).toEqual([]);
    const notLoaded = codes(result, 'image_not_loaded');
    expect(notLoaded).toHaveLength(16);
    expect(notLoaded.every((loss) => loss.severity === 'dropped')).toBe(true);
  });

  it('reports dropped columns once each, with the rows that carried data', () => {
    const summary = summarizeLossReport(result.report);
    const group = (code: string) => summary.groups.find((entry) => entry.code === code);
    expect(group('tax')?.count).toBe(23);
    expect(group('weight')?.detail).toMatch(/Weight and size/);
    expect(group('downloadable_files')?.count).toBe(2);
    expect(group('catalog_visibility')?.count).toBe(1);
    expect(group('unmapped_header')?.examples).toEqual(['Meta: _wpcom_is_markdown']);
    expect(group('condition_defaulted')?.count).toBe(16);
    expect(group('return_policy_absent')?.count).toBe(16);
    expect(summary.skipped).toBe(2);
  });

  it('strips HTML from descriptions and keeps the short description when it adds text', () => {
    const tee = result.rows.find((row) => row.listingId === 'woo-vneck-tee');
    expect(tee?.description.startsWith('This is a variable product.')).toBe(true);
    expect(tee?.description).not.toMatch(/<[a-z]/i);
  });

  it('gives the semicolon and BOM file exactly the same rows and losses', () => {
    const semicolon = map(fixture('sample_products.semicolon-bom.csv'));
    expect(semicolon.rows).toEqual(result.rows);
    expect(semicolon.report).toEqual(result.report);
  });
});

describe('WooCommerce mapping rules', () => {
  it('links variations by id:N as well as by SKU, in any row order', () => {
    const result = map(
      csv(
        '12,variation,shirt-s,Shirt - S,1,,,,,1,4,,20,,,,id:11,Size,S,,',
        '13,variation,shirt-m,Shirt - M,1,,,,,1,6,,22,,,,shirt,Size,M,,',
        '11,variable,shirt,Shirt,1,Short,<p>Long</p>,,,1,,,,Clothing,,,,Size,"S, M",,',
      ),
    );
    expect(result.rows.map((row) => [row.variantId, row.variantQuantity, row.options])).toEqual([
      ['shirt-s', 4, { Size: 'S' }],
      ['shirt-m', 6, { Size: 'M' }],
    ]);
    expect(result.rows.map((row) => row.amountMinor)).toEqual([2_000, 2_000]);
    expect(result.rows[1]?.extraFields[VARIANT_PRICE_MINOR_FIELD]).toBe('2200');
  });

  it('reports an orphan variation and a variable product with no variations without failing the file', () => {
    const result = map(
      csv(
        '1,variation,v1,V1,1,,,,,1,3,,5,,,,missing-parent,Size,S,,',
        '2,variable,lonely,Lonely,1,,,,,1,,,,,,,,,,,',
        '3,simple,ok,Fine product,1,,Text,,,1,2,,9.99,,,,,,,,',
      ),
    );
    expect(result.rows.map((row) => row.listingId)).toEqual(['ok']);
    expect(codes(result, 'variation_orphan')).toHaveLength(1);
    expect(codes(result, 'no_variations')).toHaveLength(1);
    expect(result.report).toMatchObject({ listingsRead: 3, listingsImported: 1, listingsSkipped: 2 });
  });

  it('maps Published to active or paused, and variation Published=0 to a disabled variant', () => {
    const result = map(
      csv(
        '1,simple,pub,Published item,1,,Text,,,1,2,,5,,,,,,,,',
        '2,simple,draft,Draft item,0,,Text,,,1,2,,5,,,,,,,,',
        '3,simple,private,Private item,-1,,Text,,,1,2,,5,,,,,,,,',
        '4,variable,mix,Mixed,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '5,variation,mix-s,Mixed S,1,,,,,1,3,,5,,,,mix,Size,S,,',
        '6,variation,mix-m,Mixed M,0,,,,,1,3,,5,,,,mix,Size,M,,',
      ),
    );
    const state = (id: string) => result.rows.find((row) => row.listingId === id)?.state;
    expect([state('pub'), state('draft'), state('private'), state('mix')]).toEqual([
      'active',
      'paused',
      'paused',
      'active',
    ]);
    expect(codes(result, 'draft_paused').map((loss) => loss.listing)).toEqual(['Draft item', 'Private item']);
    expect(result.rows.filter((row) => row.listingId === 'mix').map((row) => row.variantEnabled)).toEqual([
      true,
      false,
    ]);
  });

  it('reads stock from Stock, In stock?, or the unmanaged default', () => {
    const result = map(
      csv(
        '1,simple,a-stock,Counted,1,,Text,,,1,12,,5,,,,,,,,',
        '2,simple,b-out,Out of stock,1,,Text,,,0,,,5,,,,,,,,',
        '3,simple,c-flag,Flag only,1,,Text,,,1,,,5,,,,,,,,',
        '4,simple,d-neg,Backorder count,1,,Text,,,1,-3,,5,,,,,,,,',
        '5,simple,e-big,Huge count,1,,Text,,,1,5000000,,5,,,,,,,,',
      ),
      { ...IMPORT_SETTINGS_COMPLETE, unmanagedStock: 7 },
    );
    const quantity = (id: string) => result.rows.find((row) => row.listingId === id)?.variantQuantity;
    expect([quantity('a-stock'), quantity('b-out'), quantity('c-flag'), quantity('d-neg'), quantity('e-big')]).toEqual([
      12, 0, 7, 0, 999_999,
    ]);
    expect(result.rows.find((row) => row.listingId === 'b-out')?.state).toBe('paused');
    expect(codes(result, 'no_stock_paused').map((loss) => loss.listing)).toEqual(['Out of stock', 'Backorder count']);
    expect(codes(result, 'stock_capped')).toHaveLength(1);
  });

  it('honours a sale schedule against the import date', () => {
    const result = map(
      csv(
        '1,simple,live,Live sale,1,,Text,2026-10-01,2026-10-31,1,2,8,10,,,,,,,,',
        '2,simple,over,Expired sale,1,,Text,2026-01-01,2026-02-01,1,2,8,10,,,,,,,,',
        '3,simple,soon,Future sale,1,,Text,2027-01-01,,1,2,8,10,,,,,,,,',
      ),
    );
    const price = (id: string) => result.rows.find((row) => row.listingId === id)?.amountMinor;
    expect([price('live'), price('over'), price('soon')]).toEqual([800, 1_000, 1_000]);
    expect(codes(result, 'sale_schedule')).toHaveLength(3);
  });

  it('skips only the rows whose price cannot be used, and says why', () => {
    const result = map(
      csv(
        '1,simple,fine,Fine,1,,Text,,,1,2,,10,,,,,,,,',
        '2,simple,nopr,No price,1,,Text,,,1,2,,,,,,,,,,',
        '3,simple,zero,Zero price,1,,Text,,,1,2,,0,,,,,,,,',
        '4,simple,frac,Too precise,1,,Text,,,1,2,,10.555,,,,,,,,',
        '5,simple,text,Text price,1,,Text,,,1,2,,ten,,,,,,,,',
      ),
    );
    expect(result.rows.map((row) => row.listingId)).toEqual(['fine']);
    expect(
      result.report.losses.filter((loss) => loss.severity === 'skipped').map((loss) => [loss.code, loss.listing]),
    ).toEqual([
      ['price_missing', 'No price'],
      ['price_zero', 'Zero price'],
      ['price_scale', 'Too precise'],
      ['price_scale', 'Text price'],
    ]);
  });

  it('keeps JPY prices in whole yen and refuses fractions of a yen', () => {
    const settings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'JPY' };
    const result = map(
      csv('1,simple,a,Yen item,1,,Text,,,1,2,,1500,,,,,,,,', '2,simple,b,Half yen,1,,Text,,,1,2,,1500.50,,,,,,,,'),
      settings,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ amountMinor: 1_500, currency: 'JPY', exponent: 0 });
    expect(codes(result, 'price_scale')).toHaveLength(1);
  });

  it('reads comma decimals only in a semicolon file', () => {
    const text = `${HEADER.replaceAll(',', ';')}\n1;simple;a;Euro item;1;;Text;;;1;3;;12,50;;;;;;;;\n`;
    const result = map(text, { ...IMPORT_SETTINGS_COMPLETE, currency: 'EUR' });
    expect(result.rows[0]).toMatchObject({ amountMinor: 1_250, currency: 'EUR', exponent: 2 });
  });

  it('puts extra categories and tags in tags, within the tag limits', () => {
    const tags = Array.from({ length: 12 }, (_, index) => `tag${index}`).join(', ');
    const result = map(
      csv(`1,simple,a,Tagged,1,,Text,,,1,2,,5,"Clothing > Hats, Gifts > Winter, Sale",${JSON.stringify(tags)},,,,,,`),
    );
    const row = result.rows[0];
    expect(row?.category).toBe('Clothing > Hats');
    expect(row?.tags).toHaveLength(10);
    expect(row?.tags.slice(0, 2)).toEqual(['tag0', 'tag1']);
    expect(codes(result, 'tags_truncated')).toHaveLength(1);
  });

  it('makes ids path-safe and unique, and refuses a duplicate SKU instead of failing the file', () => {
    const result = map(
      csv(
        '1,simple,My SKU/1,First,1,,Text,,,1,2,,5,,,,,,,,',
        '2,simple,My SKU/1,Second,1,,Text,,,1,2,,5,,,,,,,,',
        '3,simple,,Third,1,,Text,,,1,2,,5,,,,,,,,',
      ),
    );
    expect(result.rows.map((row) => row.listingId)).toEqual(['My-SKU-1', 'woo-3']);
    expect(
      result.report.losses.filter((loss) => loss.code === 'sku_duplicate' || loss.code === 'identity_invalid'),
    ).toHaveLength(1);
  });

  it('keeps simple-product attributes only when they hold a single value', () => {
    const result = map(
      csv(
        '1,simple,one,Single,1,,Text,,,1,2,,5,,,,,Color,Red,,',
        '2,simple,many,Several,1,,Text,,,1,2,,5,,,,,Color,"Red, Blue",,',
      ),
    );
    expect(result.rows.map((row) => row.options)).toEqual([{ Color: 'Red' }, {}]);
    expect(codes(result, 'attribute_dropped')).toHaveLength(1);
  });

  it('flags a non-web image entry and caps photos at the listing limit', () => {
    const urls = Array.from({ length: 14 }, (_, index) => `https://cdn.example.com/p${index}.jpg`).join(', ');
    const result = map(csv(`1,simple,a,Photos,1,,Text,,,1,2,,5,,,${JSON.stringify(`${urls}, ftp://x/y.jpg`)},,,,,`));
    const images = JSON.parse(result.rows[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as unknown[];
    expect(images).toHaveLength(12);
    expect(codes(result, 'image_overflow')[0]?.count).toBe(2);
    expect(codes(result, 'image_url_invalid')).toHaveLength(1);
  });

  it('shortens an over-long title, falls back to the title for an empty description, and skips a title that is too short', () => {
    const result = map(
      csv(`1,simple,long,${'T'.repeat(100)},1,,,,,1,2,,5,,,,,,,,`, '2,simple,tiny,Hi,1,,Text,,,1,2,,5,,,,,,,,'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toHaveLength(80);
    expect(result.rows[0]?.description).toBe(result.rows[0]?.title);
    expect(codes(result, 'title_truncated')).toHaveLength(1);
    expect(codes(result, 'description_absent')).toHaveLength(1);
    expect(codes(result, 'title_invalid')).toHaveLength(1);
  });

  it('returns no rows and a full skip report when nothing can be imported', () => {
    const result = map(csv('1,grouped,g,Group,1,,Text,,,1,,,,,,,,,,,'));
    expect(result.rows).toEqual([]);
    expect(result.report).toMatchObject({ listingsRead: 1, listingsImported: 0, listingsSkipped: 1 });
  });

  it('notes a Windows-1252 fallback in the report', () => {
    const parsed = parseCsvTable(csv('1,simple,a,Fine,1,,Text,,,1,2,,5,,,,,,,,'));
    if (!parsed.ok) throw new Error('parse');
    const result = mapWooProductCsv({
      table: parsed.table,
      sellerPubky: SELLER,
      settings: IMPORT_SETTINGS_COMPLETE,
      now: NOW,
      encodingFallback: true,
    });
    expect(codes(result, 'encoding_fallback')).toHaveLength(1);
  });

  it('resolves a variation parent as SKU first, then id:N, then a bare ID, and only to a variable product', () => {
    const result = map(
      csv(
        '7718,variable,other,Decoy by id,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '1,variable,7718,Real parent,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '2,variation,,Child by sku,1,,,,,1,3,,10,,,,7718,Size,S,,',
        '3,variable,sku-b,Parent B,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '4,variation,,Child by id colon,1,,,,,1,4,,10,,,,id:3,Size,S,,',
        '5,variable,sku-c,Parent C,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '6,variation,,Child by bare id,1,,,,,1,5,,10,,,,5,Size,S,,',
        '7,simple,not-variable,Simple,1,,Text,,,1,2,,10,,,,,,,,',
        '8,variation,,Child of a simple,1,,,,,1,2,,10,,,,not-variable,Size,S,,',
      ),
    );
    const byListing = (id: string) =>
      result.rows.filter((row) => row.listingId === id).map((row) => row.variantQuantity);
    expect(byListing('7718')).toEqual([3]);
    expect(byListing('sku-b')).toEqual([4]);
    expect(byListing('sku-c')).toEqual([5]);
    expect(byListing('other')).toEqual([]);
    expect(codes(result, 'variation_orphan').map((loss) => loss.listing)).toEqual(['Child of a simple']);
    expect(codes(result, 'no_variations').map((loss) => loss.listing)).toEqual(['Decoy by id']);
  });

  it('strips HTML from variation names and entities from product names', () => {
    const result = map(
      csv(
        '1,variable,shirt,Shirt &amp; Co,1,,Text,,,1,,,,,,,,Size,"S, M",,',
        '2,variation,,Shirt &amp; Co<span> - </span>M,1,,,,,1,3,,,,,,shirt,Size,M,,',
      ),
    );
    expect(result.rows).toHaveLength(0);
    expect(codes(result, 'price_missing')[0]?.listing).toBe('Shirt & Co - M');
  });

  it('gives a variation with no Images the parent images, and keeps variation-only images', () => {
    const result = map(
      csv(
        '1,variable,shirt,Shirt,1,,Text,,,1,,,,,,"https://cdn.example.com/p.jpg",,Size,"S, M",,',
        '2,variation,,Shirt S,1,,,,,1,3,,10,,,,shirt,Size,S,,',
        '3,variation,,Shirt M,1,,,,,1,3,,10,,,"https://cdn.example.com/m.jpg",shirt,Size,M,,',
      ),
    );
    const urls = (row: (typeof result.rows)[number]) =>
      (JSON.parse(row.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as { url: string }[]).map((image) => image.url);
    expect(urls(result.rows[0]!)).toEqual(['https://cdn.example.com/p.jpg', 'https://cdn.example.com/m.jpg']);
    expect(urls(result.rows[1]!)).toEqual(urls(result.rows[0]!));
  });

  it('says which price applied, with the dates, for an active, an ended and a future sale', () => {
    const result = map(
      csv(
        '1,simple,live,Live sale,1,,Text,2026-10-01,2026-10-31,1,2,8,10,,,,,,,,',
        '2,simple,over,Expired sale,1,,Text,2026-01-01,2026-02-01,1,2,8,10,,,,,,,,',
        '3,simple,soon,Future sale,1,,Text,2027-01-01,,1,2,8,10,,,,,,,,',
      ),
    );
    const detail = (listing: string) => codes(result, 'sale_schedule').find((loss) => loss.listing === listing);
    expect(detail('Live sale')).toMatchObject({
      severity: 'dropped',
      detail: expect.stringContaining('Sale price 8 applied while active (2026-10-01 to 2026-10-31)'),
    });
    expect(detail('Expired sale')).toMatchObject({
      severity: 'changed',
      detail: 'Regular price 10 applied. Sale price 8 is not active (2026-01-01 to 2026-02-01).',
    });
    expect(detail('Future sale')?.detail).toBe(
      'Regular price 10 applied. Sale price 8 is not active (2027-01-01 to no end).',
    );
  });

  it('keeps the whole sale window through its last day', () => {
    const result = map(csv('1,simple,last,Last day,1,,Text,2026-10-01,2026-10-15,1,2,8,10,,,,,,,,'));
    expect(result.rows[0]?.amountMinor).toBe(800);
  });

  it('reports a file whose headers no table knows instead of reading it', () => {
    const parsed = parseCsvTable('ID,Tipo,SKU,Nombre,Precio normal\n1,simple,a,Algo,5\n');
    if (!parsed.ok) throw new Error('parse');
    const result = mapWooProductCsv({
      table: parsed.table,
      sellerPubky: SELLER,
      settings: IMPORT_SETTINGS_COMPLETE,
      now: NOW,
    });
    expect(result.rows).toEqual([]);
    expect(codes(result, 'unknown_language')).toHaveLength(1);
    expect(result.report.losses[0]?.detail).toMatch(/English, German, French or Italian/);
  });

  it('reads a French and an Italian export the same way as the English one', () => {
    const english = map(csv('1,simple,a,Item,1,,Text,,,1,4,,9.5,Cat,,,,,,,'));
    const fr = parseCsvTable(
      'ID;Type;UGS;Nom;Publié;Description;En stock\u00a0?;Stock;Tarif promo;Tarif régulier;Catégories\n1;simple;a;Item;1;Text;1;4;;9.5;Cat\n',
    );
    const it = parseCsvTable(
      'ID;Tipo;SKU;Nome;Pubblicato;Descrizione;In stock?;Magazzino;Prezzo in offerta;Prezzo di listino;Categorie\n1;simple;a;Item;1;Text;1;4;;9.5;Cat\n',
    );
    for (const parsed of [fr, it]) {
      if (!parsed.ok) throw new Error('parse');
      const result = mapWooProductCsv({
        table: parsed.table,
        sellerPubky: SELLER,
        settings: IMPORT_SETTINGS_COMPLETE,
        now: NOW,
      });
      expect(result.rows).toEqual(english.rows);
    }
  });
});
