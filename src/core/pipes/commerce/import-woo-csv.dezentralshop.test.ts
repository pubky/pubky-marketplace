import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvTable } from './import-csv-table';
import { summarizeLossReport } from './import-loss-report';
import { type PresetRow, SOURCE_IMAGE_URLS_FIELD, VARIANT_PRICE_MINOR_FIELD } from './import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS } from './import-settings';
import { mapWooProductCsv } from './import-woo-csv';

const FILE = resolve(__dirname, '../../../test/fixtures/woocommerce/dezentralshop-woo-export-2026-10-15.csv');
const SELLER = 'y'.repeat(52);
const NOW = new Date('2026-10-15T12:00:00.000Z');
const CHF = { ...DEFAULT_IMPORT_SETTINGS, currency: 'CHF', countryCode: 'CH' };

function map(settings = CHF) {
  const text = readFileSync(FILE, 'utf8');
  const parsed = parseCsvTable(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return mapWooProductCsv({ table: parsed.table, sellerPubky: SELLER, settings, now: NOW });
}

function imageUrls(row: PresetRow | undefined): string[] {
  return (JSON.parse(row?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as { url: string }[]).map((image) => image.url);
}

describe('real Dezentralshop export (German headers, CHF)', () => {
  const result = map();
  const rowsOf = (listingId: string) => result.rows.filter((row) => row.listingId === listingId);

  it('is the UTF-8 BOM file the merchant attached', () => {
    const bytes = readFileSync(FILE);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(readFileSync(FILE, 'utf8').split('\n')[0]).toContain('Übergeordnetes Produkt');
  });

  it('reads 12 products, imports 7 listings with 20 variants, and reports the 5 empty variable parents', () => {
    expect(result.report).toMatchObject({ listingsRead: 12, listingsImported: 7, listingsSkipped: 5 });
    expect(result.rows).toHaveLength(20);
    expect([...new Set(result.rows.map((row) => row.listingId))]).toEqual([
      '7718',
      '8106',
      '10507',
      '10578',
      '10977',
      '11769',
      'woo-3799',
    ]);
    const empty = result.report.losses.filter((loss) => loss.code === 'no_variations');
    expect(empty.map((loss) => loss.listing)).toEqual([
      'Isch Okay',
      "Node'n Schlüssel",
      'Pleb Rap',
      'First Transaction Men',
      'T-Shirt Lightning Men',
    ]);
    expect(empty.every((loss) => loss.severity === 'skipped' && loss.line !== undefined)).toBe(true);
  });

  it('prices every listing in the setting currency from major units, with no currency column', () => {
    expect(result.rows.every((row) => row.currency === 'CHF' && row.exponent === 2)).toBe(true);
    const price = (id: string) => rowsOf(id)[0]?.amountMinor;
    expect([
      price('7718'),
      price('8106'),
      price('10507'),
      price('10578'),
      price('10977'),
      price('11769'),
      price('woo-3799'),
    ]).toEqual([1_200, 4_000, 2_600, 1_500, 3_500, 3_500, 1]);
    expect(result.rows.every((row) => !(VARIANT_PRICE_MINOR_FIELD in row.extraFields))).toBe(true);
    expect(result.rows.every((row) => row.extraFields.country_code === 'CH')).toBe(true);
  });

  it.each([
    [
      '7718',
      'The Little Hodler Socks Bundle',
      [
        ['v5129', { var_Size_Feet: '37-42' }, 7],
        ['v5130', { var_Size_Feet: '42 - 47' }, 12],
      ],
    ],
    [
      '8106',
      'Formel T-Shirt Men',
      [
        ['v5554', { var_size: 'M' }, 5],
        ['v5555', { var_size: 'S' }, 2],
        ['v5556', { var_size: 'XL' }, 0],
        ['v5553', { var_size: 'L' }, 0],
      ],
    ],
    [
      '10578',
      'Bitcoin Socken in zwei Farben',
      [
        ['v5548', { Var_color: 'Schwarz', var_size: '36-42' }, 10],
        ['v5549', { Var_color: 'Schwarz', var_size: '42-47' }, 8],
        ['v5550', { Var_color: 'Weiss', var_size: '36-42' }, 6],
        ['v5551', { Var_color: 'Weiss', var_size: '42-47' }, 15],
      ],
    ],
    [
      '10977',
      'T-Shirt Lightning Lady',
      [
        ['v3585', { var_size: 'M' }, 3],
        ['v3586', { var_size: 'S' }, 1],
        ['v3587', { var_size: 'XL' }, 0],
        ['v3584', { var_size: 'L' }, 0],
      ],
    ],
    [
      '11769',
      'T-Shirt - The Orange Pill Chill',
      [
        ['v3580', { var_size: 'L' }, 2],
        ['v3581', { var_size: 'M' }, 2],
        ['v3582', { var_size: 'S' }, 0],
        ['v3583', { var_size: 'XL' }, 1],
      ],
    ],
  ] as const)('maps variable product %s with its variations, options and stock', (listingId, title, variants) => {
    const rows = rowsOf(listingId);
    expect(rows.map((row) => [row.variantId, row.options, row.variantQuantity])).toEqual(
      variants.map(([id, options, quantity]) => [id, options, quantity]),
    );
    expect(new Set(rows.map((row) => row.title))).toEqual(new Set([title]));
    expect(rows.every((row) => row.state === 'active' && row.variantEnabled)).toBe(true);
    expect(rows.every((row) => row.category === 'Bekleidung')).toBe(true);
    expect(rows.every((row) => row.sku === '')).toBe(true);
  });

  it('maps the simple products: counted stock, and a private one that is paused with the default count', () => {
    expect(rowsOf('10507')).toMatchObject([
      {
        variantId: '10507',
        sku: '10507',
        title: 'Bitcoin Basecap',
        state: 'active',
        variantQuantity: 8,
        amountMinor: 2_600,
      },
    ]);
    expect(rowsOf('woo-3799')).toMatchObject([
      {
        variantId: 'v3799',
        sku: '',
        title: 'TEST',
        state: 'paused',
        variantQuantity: 1,
        amountMinor: 1,
        category: 'Accessoires',
      },
    ]);
    const unmanaged = result.report.losses.filter((loss) => loss.code === 'stock_unmanaged');
    expect(unmanaged.map((loss) => loss.listing)).toEqual(['TEST']);
    expect(unmanaged[0]?.detail).toBe('In stock without a count, so stock is set to 1.');
    const more = map({ ...CHF, unmanagedStock: 6 });
    expect(more.rows.find((row) => row.listingId === 'woo-3799')?.variantQuantity).toBe(6);
    expect(more.rows.find((row) => row.listingId === '10507')?.variantQuantity).toBe(8);
  });

  it('uses the sale price while it applies and reports the regular price it replaced', () => {
    const socks = rowsOf('7718');
    expect(socks.map((row) => row.amountMinor)).toEqual([1_200, 1_200]);
    const dropped = result.report.losses.filter((loss) => loss.code === 'compare_at_price');
    expect(dropped.map((loss) => loss.detail)).toEqual([
      'Regular price 25 dropped; sale price 12 used.',
      'Regular price 25 dropped; sale price 12 used.',
    ]);
    expect(dropped.map((loss) => loss.listing)).toEqual([
      'The Little Hodler Socks Bundle - 37-42',
      'The Little Hodler Socks Bundle - 42 - 47',
    ]);
  });

  it('strips the HTML from variation names in the report and uses the parent name as the title', () => {
    const labels = result.report.losses.map((loss) => loss.listing ?? '');
    expect(labels.some((label) => /<|&lt;/.test(label))).toBe(false);
    expect(labels).toContain('The Little Hodler Socks Bundle - 37-42');
  });

  it('gives each variation the parent images, since the variations carry none', () => {
    const urls = (id: string) => imageUrls(rowsOf(id)[0]);
    expect(urls('7718')).toHaveLength(4);
    expect(urls('8106')).toHaveLength(2);
    expect(urls('10578')).toHaveLength(6);
    expect(urls('10977')).toHaveLength(2);
    expect(urls('11769')).toHaveLength(2);
    expect(urls('10507')).toHaveLength(4);
    expect(imageUrls(rowsOf('woo-3799')[0])).toEqual([]);
    for (const id of ['7718', '8106', '10578', '10977', '11769']) {
      const first = imageUrls(rowsOf(id)[0]);
      expect(rowsOf(id).every((row) => JSON.stringify(imageUrls(row)) === JSON.stringify(first))).toBe(true);
    }
    expect(urls('8106').every((url) => url.startsWith('https://dezentralshop.ch/'))).toBe(true);
    expect(result.rows.every((row) => row.media.length === 0)).toBe(true);
  });

  it('reports exactly what was skipped, changed and left behind', () => {
    const summary = summarizeLossReport(result.report);
    const counts = Object.fromEntries(summary.groups.map((group) => [`${group.severity}:${group.code}`, group.count]));
    expect(counts).toEqual({
      'skipped:no_variations': 5,
      'changed:condition_defaulted': 7,
      'changed:stock_unmanaged': 1,
      'changed:draft_paused': 1,
      'dropped:compare_at_price': 2,
      'dropped:image_not_loaded': 20,
      'dropped:tags_truncated': 2,
      'dropped:unmapped_header': 1,
      'dropped:tax': 25,
      'dropped:weight': 6,
      'dropped:shipping_class': 6,
      'dropped:related_products': 24,
      'dropped:return_policy_absent': 7,
    });
    expect(summary).toMatchObject({ skipped: 5 });
    const unmapped = result.report.losses.find((loss) => loss.code === 'unmapped_header');
    expect(unmapped?.source).toBe('Marken');
    const tax = result.report.losses.find((loss) => loss.code === 'tax');
    expect(tax?.source).toBe('Steuerstatus');
    expect(result.report.losses.some((loss) => loss.code === 'unknown_language')).toBe(false);
  });
});
