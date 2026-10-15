import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { summarizeLossReport } from './import-loss-report';
import { SOURCE_IMAGE_URLS_FIELD, VARIANT_PRICE_MINOR_FIELD } from './import-preset-rows';
import type { ImportSettings } from './import-settings';
import {
  mapWooStoreCatalog,
  storeCurrency,
  storeIdKey,
  type WooStoreCatalog,
  type WooStoreMapResult,
} from './import-woo-store';

const SELLER = 'y'.repeat(52);
const STORE = 'https://dezentralshop.ch';
const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce/store-api');
const CHF: ImportSettings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' };
const OFFERED = ['USD', 'CHF'];

function json<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as T;
}

const REAL_PRODUCTS = [1, 2, 3].flatMap((page) => json<StoreApiProduct[]>(`dezentralshop-products-p${page}.json`));
const REAL_VARIATIONS = json<Record<string, StoreApiProduct>>('dezentralshop-variations.json');

function catalogOf(products: readonly StoreApiProduct[], variations = REAL_VARIATIONS): WooStoreCatalog {
  const grouped: Record<string, StoreApiProduct[]> = {};
  for (const product of products) {
    if (product.type !== 'variable') continue;
    grouped[String(product.id)] = product.variations.flatMap((ref) =>
      variations[ref.id] ? [variations[ref.id]!] : [],
    );
  }
  return { storeUrl: STORE, products, variations: grouped, unreadProducts: 0, total: products.length };
}

function map(
  catalog: WooStoreCatalog,
  settings: ImportSettings = CHF,
  offeredCurrencies: readonly string[] = OFFERED,
): Extract<WooStoreMapResult, { ok: true }> {
  const result = mapWooStoreCatalog({ catalog, sellerPubky: SELLER, settings, offeredCurrencies });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function product(overrides: Partial<StoreApiProduct> = {}): StoreApiProduct {
  return {
    id: 100,
    type: 'simple',
    parent: 0,
    name: 'Plain mug',
    sku: '',
    short_description: '',
    description: '<p>A mug.</p>',
    on_sale: false,
    prices: {
      price: '2500',
      regular_price: '2500',
      sale_price: '2500',
      currency_code: 'CHF',
      currency_minor_unit: 2,
    },
    images: [{ src: 'https://shop.example.com/mug.jpg', alt: 'A mug' }],
    categories: [{ name: 'Kitchen' }],
    tags: [],
    brands: [],
    attributes: [],
    variations: [],
    is_in_stock: true,
    is_on_backorder: false,
    low_stock_remaining: 4,
    sold_individually: false,
    add_to_cart: { maximum: null },
    is_password_protected: false,
    weight: '',
    has_dimensions: false,
    ...overrides,
  };
}

function codes(result: Extract<WooStoreMapResult, { ok: true }>, code: string) {
  return result.report.losses.filter((loss) => loss.code === code);
}

const byId = (result: Extract<WooStoreMapResult, { ok: true }>, id: number) =>
  result.rows.filter((row) => row.sourceListingKey.endsWith(`:${id}`));

describe('the real Dezentralshop catalogue (279 products, 10 variable)', () => {
  const result = map(catalogOf(REAL_PRODUCTS));

  it('imports every product, with one variant per simple product and one per variation', () => {
    expect(result.report).toMatchObject({
      format: 'woocommerce_store',
      listingsRead: 279,
      listingsImported: 279,
      listingsSkipped: 0,
    });
    expect(new Set(result.rows.map((row) => row.listingId)).size).toBe(279);
    expect(result.rows).toHaveLength(269 + 30);
    expect(
      result.rows.every((row) => row.currency === 'CHF' && row.exponent === 2 && row.recordRevision === null),
    ).toBe(true);
  });

  it('prices a simple product from prices.price in minor units, with its photo, category and stock note', () => {
    const [row] = byId(result, 6820);
    expect(row).toMatchObject({
      title: 'Avalon Q Ersatzventilator – MARTECH DF1202512RFUN, 120 mm',
      amountMinor: 1_200,
      variantId: 'v6820',
      category: 'Mining',
      state: 'active',
      variantQuantity: 12,
      options: {},
    });
    expect(JSON.parse(row?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]')).toEqual([
      {
        url: 'https://dezentralshop.ch/wp-content/uploads/2026/09/Luefter-fuer-Avalon-Q.webp',
        alt: expect.any(String),
      },
    ]);
    expect(row?.description).toContain('Passend für den Avalon Q');
    expect(row?.description).toContain('• Hersteller: MARTECH');
    expect(row?.description).toContain('Feature (Mining): Mining Zubehör, Zubehör');
    expect(row?.description).not.toMatch(/<|&#/);
  });

  it('turns a variable product and its variation reads into one listing with options, a floor price and overrides', () => {
    const miner = byId(result, 5398);
    expect(miner.map((row) => row.variantId)).toEqual(['v5524', 'v5525', 'v5526']);
    expect(miner.map((row) => row.options)).toEqual([
      { Hashrate: '110 TH/s' },
      { Hashrate: '115 TH/s' },
      { Hashrate: '120 TH/s' },
    ]);
    expect(miner.map((row) => row.amountMinor)).toEqual([74_900, 74_900, 74_900]);
    expect(miner.map((row) => row.extraFields[VARIANT_PRICE_MINOR_FIELD])).toEqual([undefined, '77900', '79900']);
    expect(miner.map((row) => row.extraFields.external_variant_id)).toEqual(['woo:5524', 'woo:5525', 'woo:5526']);
    expect(new Set(miner.map((row) => row.listingId)).size).toBe(1);
    expect(miner.every((row) => row.title === 'Antminer S19k Pro – 110-120 TH/s')).toBe(true);
  });

  it('leaves out the SKU every variation inherits from its product, and says so once per listing', () => {
    expect(byId(result, 5398).every((row) => row.sku === '')).toBe(true);
    expect(codes(result, 'sku_dropped')).toHaveLength(10);
    expect(codes(result, 'sku_dropped')[0]?.detail).toContain('share their product');
  });

  it("takes the store's cart limit as stock for every in-stock product that has one, and flags each", () => {
    const candidates = [...REAL_PRODUCTS.filter((entry) => entry.type === 'simple'), ...Object.values(REAL_VARIATIONS)];
    const limited = candidates.filter(
      (entry) =>
        entry.is_in_stock &&
        !entry.sold_individually &&
        entry.add_to_cart.maximum !== null &&
        entry.add_to_cart.maximum < 9_999,
    );
    expect(limited.length).toBeGreaterThan(250);
    for (const entry of limited) {
      const row = result.rows.find((candidate) => candidate.variantId === `v${entry.id}`);
      expect(row?.variantQuantity).toBe(entry.add_to_cart.maximum);
    }
    expect(codes(result, 'stock_from_cart_limit')).toHaveLength(limited.length);
    expect(codes(result, 'stock_from_cart_limit')[0]).toMatchObject({
      severity: 'changed',
      detail: "Stock from the store's cart limit, check it.",
    });
    expect(codes(result, 'stock_unmanaged')).toHaveLength(
      candidates.filter((entry) => entry.is_in_stock && !limited.includes(entry)).length,
    );
  });

  it('gives an out-of-stock product no stock and pauses the listing', () => {
    const out = REAL_PRODUCTS.find((entry) => entry.type === 'simple' && !entry.is_in_stock);
    expect(out).toBeDefined();
    const [row] = byId(result, out!.id);
    expect(row).toMatchObject({ variantQuantity: 0, state: 'paused' });
    expect(codes(result, 'no_stock_paused').length).toBeGreaterThanOrEqual(13);
  });

  it('prices a sale at the price buyers pay and reports the regular price it dropped', () => {
    const onSale = REAL_PRODUCTS.find((entry) => entry.type === 'simple' && entry.on_sale);
    expect(onSale).toBeDefined();
    const [row] = byId(result, onSale!.id);
    expect(row?.amountMinor).toBe(Number(onSale?.prices?.price));
    expect(row?.amountMinor).toBeLessThan(Number(onSale?.prices?.regular_price));
    expect(codes(result, 'compare_at_price')).toHaveLength(26);
    expect(codes(result, 'compare_at_price')[0]?.detail).toMatch(
      /^Regular price \d+\.\d\d dropped; sale price \d+\.\d\d used\.$/,
    );
  });

  it('keeps long titles at 80 characters and reports it, and keeps at most 12 distinct photos per listing', () => {
    expect(codes(result, 'title_truncated')).toHaveLength(2);
    expect(Math.max(...result.rows.map((row) => row.title.length))).toBeLessThanOrEqual(80);
    const repeated = REAL_PRODUCTS.find((entry) => entry.id === 6746);
    expect(repeated?.images).toHaveLength(13);
    const urls = JSON.parse(byId(result, 6746)[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as unknown[];
    expect(urls).toHaveLength(12);
    expect(codes(result, 'image_overflow')).toHaveLength(0);
    const crowded = product({
      images: Array.from({ length: 15 }, (_, index) => ({ src: `https://shop.example.com/${index}.jpg`, alt: '' })),
    });
    const over = map(catalogOf([crowded]));
    expect(JSON.parse(over.rows[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]')).toHaveLength(12);
    expect(codes(over, 'image_overflow')[0]).toMatchObject({ severity: 'dropped', count: 3 });
  });

  it('says exact stock is not public, that tax is as displayed, and what else is not imported', () => {
    const summary = summarizeLossReport(result.report);
    const stock = summary.groups.find((group) => group.code === 'stock_not_public');
    expect(stock).toMatchObject({ severity: 'changed', count: 279, label: 'Exact stock not public' });
    expect(stock?.detail).toContain("Exact stock isn't public");
    expect(stock?.detail).toContain('Connect the store for live stock.');
    expect(summary.groups.map((group) => group.code)).toEqual(
      expect.arrayContaining([
        'tax_display',
        'weight',
        'condition_defaulted',
        'return_policy_absent',
        'attribute_in_description',
      ]),
    );
    expect(codes(result, 'weight')[0]?.count).toBe(279);
  });

  it('says when the catalogue has more photos than one import loads, and how many are over', () => {
    const codeOf = codes(result, 'photos_over_import_limit');
    expect(codeOf).toHaveLength(1);
    expect(codeOf[0]).toMatchObject({ severity: 'changed', count: 225 });
    expect(codeOf[0]?.detail).toContain('725 photos');
    expect(codeOf[0]?.detail).toContain('at most 500');
    const small = map(catalogOf(REAL_PRODUCTS.slice(0, 20)));
    expect(codes(small, 'photos_over_import_limit')).toHaveLength(0);
  });

  it('gives no listing a shipping option or a country the seller did not choose', () => {
    const none = mapWooStoreCatalog({
      catalog: catalogOf(REAL_PRODUCTS.slice(0, 3)),
      sellerPubky: SELLER,
      settings: { ...CHF, shipping: null, countryCode: null },
      offeredCurrencies: OFFERED,
    });
    expect(none.ok && none.rows.every((row) => row.shippingOptions.length === 0)).toBe(true);
    expect(none.ok && none.rows.every((row) => row.extraFields.country_code === undefined)).toBe(true);
    expect(result.rows.every((row) => row.shippingOptions.length === 1 && row.extraFields.country_code === 'CH')).toBe(
      true,
    );
  });
});

describe('listing ids', () => {
  it('are stable per store product id, and differ between stores so two shops cannot overwrite each other', () => {
    const catalog = catalogOf([product({ id: 6820 }), product({ id: 6821, name: 'Second mug' })]);
    const first = map(catalog).rows.map((row) => row.listingId);
    expect(first).toEqual([`woo-${storeIdKey(STORE)}-6820`, `woo-${storeIdKey(STORE)}-6821`]);
    expect(map(catalog).rows.map((row) => row.listingId)).toEqual(first);
    const other = map({ ...catalog, storeUrl: 'https://other-shop.example.com' }).rows.map((row) => row.listingId);
    expect(other).not.toEqual(first);
    expect(storeIdKey('HTTPS://DezentralShop.ch ')).toBe(storeIdKey(STORE));
  });

  it('do not change when the store renames, re-prices or re-skus a product', () => {
    const before = map(catalogOf([product({ id: 7 })])).rows[0]?.listingId;
    const after = map(catalogOf([product({ id: 7, name: 'Renamed mug', sku: 'NEW-SKU' })])).rows[0]?.listingId;
    expect(after).toBe(before);
  });
});

describe('currency', () => {
  it('takes the store currency, and refuses one the listing form does not offer without converting', () => {
    const refused = mapWooStoreCatalog({
      catalog: catalogOf([product()]),
      sellerPubky: SELLER,
      settings: CHF,
      offeredCurrencies: ['USD', 'BTC'],
    });
    expect(refused).toEqual({
      ok: false,
      message:
        'This store sells in CHF. Pubky listings can be priced in USD, BTC, and prices are never converted. Nothing was imported.',
    });
  });

  it('prices in the store currency whatever the settings say, so a mismatched select cannot relabel prices', () => {
    const result = map(catalogOf([product()]), { ...CHF, currency: 'USD' });
    expect(result.rows[0]).toMatchObject({ currency: 'CHF', amountMinor: 2_500 });
  });

  it('writes the flat shipping option in the store currency too, whatever the settings currency says', () => {
    const flat: ImportSettings = {
      ...CHF,
      currency: 'USD',
      shipping: { mode: 'flat', priceMinor: 790, minDays: 2, maxDays: 5 },
    };
    const result = map(catalogOf([product()]), flat);
    expect(result.rows[0]?.shippingOptions[0]).toMatchObject({
      pricing: 'flat',
      price: { amountMinor: 790, currency: 'CHF', exponent: 2 },
    });
  });

  it('skips a product priced in another currency than the store and says so', () => {
    const odd = product({
      id: 2,
      name: 'Euro mug',
      prices: { price: '900', regular_price: '900', sale_price: '900', currency_code: 'EUR', currency_minor_unit: 2 },
    });
    const result = map(catalogOf([product({ id: 1 }), product({ id: 3, name: 'Second mug' }), odd]), CHF, [
      'CHF',
      'EUR',
    ]);
    expect(result.rows).toHaveLength(2);
    expect(codes(result, 'currency_mismatch')[0]).toMatchObject({ severity: 'skipped', listing: 'Euro mug' });
  });

  it('rescales a store that counts minor units differently, and refuses what would lose digits', () => {
    const yen = product({
      prices: {
        price: '1500',
        regular_price: '1500',
        sale_price: '1500',
        currency_code: 'JPY',
        currency_minor_unit: 0,
      },
    });
    expect(map(catalogOf([yen]), { ...CHF, currency: 'JPY' }, ['JPY']).rows[0]?.amountMinor).toBe(1_500);
    const shifted = product({
      prices: {
        price: '1234',
        regular_price: '1234',
        sale_price: '1234',
        currency_code: 'JPY',
        currency_minor_unit: 2,
      },
    });
    const result = map(catalogOf([shifted]), { ...CHF, currency: 'JPY' }, ['JPY']);
    expect(result.rows).toHaveLength(0);
    expect(codes(result, 'price_scale')).toHaveLength(1);
  });

  it('reports a store with no priced products and finds the main currency by count', () => {
    expect(
      mapWooStoreCatalog({
        catalog: catalogOf([product({ prices: null })]),
        sellerPubky: SELLER,
        settings: CHF,
        offeredCurrencies: OFFERED,
      }),
    ).toEqual({ ok: false, message: 'This store lists no priced products, so there is nothing to import.' });
    expect(storeCurrency(REAL_PRODUCTS)).toBe('CHF');
  });
});

describe('stock', () => {
  it('uses the default quantity setting for a count the store does not share, flagged as unknown', () => {
    const result = map(catalogOf([product({ low_stock_remaining: null })]), { ...CHF, unmanagedStock: 7 });
    expect(result.rows[0]?.variantQuantity).toBe(7);
    expect(codes(result, 'stock_unmanaged')[0]).toMatchObject({
      detail: 'Stock unknown, set to 7.',
      listing: 'Plain mug',
    });
  });

  it('uses low_stock_remaining as the count, without a flag, when there is no cart limit', () => {
    const result = map(catalogOf([product({ low_stock_remaining: 3 })]), { ...CHF, unmanagedStock: 7 });
    expect(result.rows[0]?.variantQuantity).toBe(3);
    expect(codes(result, 'stock_unmanaged')).toHaveLength(0);
    expect(codes(result, 'stock_from_cart_limit')).toHaveLength(0);
  });

  describe('the cart limit (add_to_cart.maximum)', () => {
    const real = (id: number) => REAL_PRODUCTS.find((entry) => entry.id === id)!;
    const COUNTED_REAL = REAL_PRODUCTS.find(
      (entry) => entry.type === 'simple' && entry.is_in_stock && entry.add_to_cart.maximum === 5,
    )!;

    it('is the stock when it is below 9999, and says so for that item', () => {
      const result = map(catalogOf([COUNTED_REAL]), { ...CHF, unmanagedStock: 1 });
      expect(result.rows[0]?.variantQuantity).toBe(5);
      expect(codes(result, 'stock_from_cart_limit')).toEqual([
        expect.objectContaining({
          code: 'stock_from_cart_limit',
          severity: 'changed',
          listing: expect.stringContaining(COUNTED_REAL.name.slice(0, 10)),
          detail: "Stock from the store's cart limit, check it.",
        }),
      ]);
      expect(codes(result, 'stock_unmanaged')).toHaveLength(0);
    });

    it('wins over the low-stock count, and the file-wide note counts only items with neither', () => {
      const result = map(
        catalogOf([
          product({ id: 1, low_stock_remaining: 2, add_to_cart: { maximum: 4 } }),
          product({ id: 2, name: 'Mug two', low_stock_remaining: null, add_to_cart: { maximum: null } }),
        ]),
      );
      expect(result.rows.map((row) => row.variantQuantity)).toEqual([4, 1]);
      expect(codes(result, 'stock_not_public')[0]?.detail).toContain('1 item has neither');
      expect(codes(result, 'stock_not_public')[0]?.detail).toContain('Connect the store for live stock.');
    });

    it('is not stock at 9999, which WooCommerce sends for unmanaged stock: the default quantity applies', () => {
      const unmanaged = { ...COUNTED_REAL, add_to_cart: { maximum: 9_999 }, low_stock_remaining: null };
      const result = map(catalogOf([unmanaged]), { ...CHF, unmanagedStock: 6 });
      expect(result.rows[0]?.variantQuantity).toBe(6);
      expect(codes(result, 'stock_unmanaged')[0]?.detail).toBe('Stock unknown, set to 6.');
      expect(codes(result, 'stock_from_cart_limit')).toHaveLength(0);
    });

    it('is not stock for a one-per-order product, where the limit is the rule and not the count', () => {
      const single = {
        ...COUNTED_REAL,
        sold_individually: true,
        add_to_cart: { maximum: 1 },
        low_stock_remaining: null,
      };
      const result = map(catalogOf([single]), { ...CHF, unmanagedStock: 6 });
      expect(result.rows[0]?.variantQuantity).toBe(6);
      expect(codes(result, 'stock_from_cart_limit')).toHaveLength(0);
      expect(codes(result, 'stock_unmanaged')).toHaveLength(1);
      const withCount = { ...single, low_stock_remaining: 2 };
      expect(map(catalogOf([withCount])).rows[0]?.variantQuantity).toBe(2);
    });

    it('never makes an out-of-stock or backorder product available, whatever the limit says', () => {
      const out = real(REAL_PRODUCTS.find((entry) => entry.type === 'simple' && !entry.is_in_stock)!.id);
      const odd = REAL_PRODUCTS.find(
        (entry) => entry.type === 'simple' && !entry.is_in_stock && entry.add_to_cart.maximum !== 9_999,
      );
      for (const entry of [out, odd ?? out, { ...COUNTED_REAL, is_in_stock: false }]) {
        const result = map(catalogOf([entry]));
        expect(result.rows[0]).toMatchObject({ variantQuantity: 0, state: 'paused' });
        expect(codes(result, 'stock_from_cart_limit')).toHaveLength(0);
      }
      const backorder = map(catalogOf([{ ...COUNTED_REAL, is_on_backorder: true }]));
      expect(backorder.rows[0]?.variantQuantity).toBe(0);
      expect(codes(backorder, 'backorder_stock')).toHaveLength(1);
    });

    it('applies to a variation read as it does to a product, and not to the variable parent', () => {
      const result = map(catalogOf([real(5398)]));
      expect(result.rows.map((row) => row.variantQuantity)).toEqual(
        [5524, 5525, 5526].map((id) => REAL_VARIATIONS[id]!.add_to_cart.maximum),
      );
      expect(real(5398).add_to_cart.maximum).not.toBeNull();
    });
  });

  it('gives an out-of-stock product 0 whatever count it shows, and pauses the listing', () => {
    const result = map(catalogOf([product({ is_in_stock: false, low_stock_remaining: 5 })]));
    expect(result.rows[0]).toMatchObject({ variantQuantity: 0, state: 'paused' });
    expect(codes(result, 'no_stock_paused')).toHaveLength(1);
  });

  it('gives a backorder product 0 and says why', () => {
    const result = map(catalogOf([product({ is_on_backorder: true, low_stock_remaining: null })]));
    expect(result.rows[0]?.variantQuantity).toBe(0);
    expect(codes(result, 'backorder_stock')).toHaveLength(1);
  });

  it('flags every unknown count once in the file-wide note', () => {
    const result = map(
      catalogOf([
        product({ id: 1, low_stock_remaining: null }),
        product({ id: 2, name: 'Mug two', low_stock_remaining: 2 }),
      ]),
    );
    expect(codes(result, 'stock_not_public')).toHaveLength(1);
    expect(codes(result, 'stock_not_public')[0]?.detail).toContain('1 item has neither');
  });
});

describe('products the import cannot or will not take', () => {
  it('skips grouped, external and unknown types and password-protected products with a reason each', () => {
    const result = map(
      catalogOf([
        product({ id: 1 }),
        product({ id: 2, type: 'grouped', name: 'A bundle' }),
        product({ id: 3, type: 'external', name: 'Elsewhere' }),
        product({ id: 4, type: 'subscription', name: 'Monthly box' }),
        product({ id: 5, name: 'Secret mug', is_password_protected: true }),
      ]),
    );
    expect(result.report).toMatchObject({ listingsRead: 5, listingsImported: 1, listingsSkipped: 4 });
    expect(codes(result, 'unsupported_type').map((loss) => loss.listing)).toEqual([
      'A bundle',
      'Elsewhere',
      'Monthly box',
    ]);
    expect(codes(result, 'password_protected')).toHaveLength(1);
  });

  it('skips a simple product with no usable price, and keeps the rest', () => {
    const result = map(
      catalogOf([
        product({ id: 1 }),
        product({
          id: 2,
          name: 'Free mug',
          prices: { ...product().prices!, price: '0', regular_price: '0', sale_price: '0' },
        }),
        product({ id: 3, name: 'No price mug', prices: { ...product().prices!, price: '' } }),
      ]),
    );
    expect(result.rows).toHaveLength(1);
    expect(codes(result, 'price_zero')).toHaveLength(1);
    expect(codes(result, 'price_missing')).toHaveLength(1);
  });

  it('reports a variable product with no variations, and one whose variations could not be read', () => {
    const variable = product({
      id: 10,
      type: 'variable',
      name: 'Shirt',
      variations: [
        { id: 11, attributes: [{ name: 'Size', value: 'S' }] },
        { id: 12, attributes: [{ name: 'Size', value: 'M' }] },
      ],
    });
    const none = map(catalogOf([product({ id: 9, type: 'variable', name: 'Empty shirt' })]));
    expect(codes(none, 'no_variations')).toHaveLength(1);

    const readS = product({ id: 11, type: 'variation', parent: 10, name: 'Shirt' });
    const partial = map({ ...catalogOf([variable]), variations: { '10': [readS] } });
    expect(partial.rows).toHaveLength(1);
    expect(codes(partial, 'variation_unread')[0]).toMatchObject({ severity: 'dropped', count: 1, listing: 'Shirt' });

    const noneRead = map({ ...catalogOf([variable]), variations: {} });
    expect(noneRead.rows).toHaveLength(0);
    expect(codes(noneRead, 'variation_unread')[0]).toMatchObject({ severity: 'skipped', count: 2 });
  });

  it('keeps only one of two variations that offer the same options, and imports a variation for any value without that option', () => {
    const variable = product({
      id: 10,
      type: 'variable',
      name: 'Shirt',
      variations: [
        { id: 11, attributes: [{ name: 'Size', value: 'S' }] },
        { id: 12, attributes: [{ name: 'Size', value: 'S' }] },
        { id: 13, attributes: [{ name: 'Size', value: '' }] },
      ],
    });
    const reads = [11, 12, 13].map((id) => product({ id, type: 'variation', parent: 10, name: 'Shirt' }));
    const result = map({ ...catalogOf([variable]), variations: { '10': reads } });
    expect(result.rows.map((row) => row.variantId)).toEqual(['v11', 'v13']);
    expect(codes(result, 'variant_duplicate')).toHaveLength(1);
    expect(codes(result, 'attribute_dropped')[0]?.count).toBe(1);
  });

  it('drops a SKU that two products share instead of failing the file', () => {
    const result = map(
      catalogOf([
        product({ id: 1, sku: 'MUG' }),
        product({ id: 2, name: 'Mug two', sku: 'MUG' }),
        product({ id: 3, name: 'Mug three', sku: 'OWN' }),
      ]),
    );
    expect(result.rows.map((row) => row.sku)).toEqual(['', '', 'OWN']);
    expect(codes(result, 'sku_dropped')).toHaveLength(2);
  });

  it('reports products the store listed but this import could not read, and a catalogue larger than it read', () => {
    const result = map({ ...catalogOf([product()]), unreadProducts: 2, total: 400 });
    expect(codes(result, 'product_unreadable')[0]).toMatchObject({ severity: 'skipped', count: 2 });
    expect(codes(result, 'catalog_truncated')[0]).toMatchObject({ severity: 'skipped', count: 397 });
    expect(result.report.listingsRead).toBe(400);
    expect(result.report.listingsSkipped).toBe(399);
  });
});

describe('photos', () => {
  it('keeps secure photo links, the parent photos first then each variation, without repeats', () => {
    const variable = product({
      id: 10,
      type: 'variable',
      name: 'Shirt',
      images: [{ src: 'https://shop.example.com/a.jpg', alt: 'A' }],
      variations: [
        { id: 11, attributes: [{ name: 'Size', value: 'S' }] },
        { id: 12, attributes: [{ name: 'Size', value: 'M' }] },
      ],
    });
    const reads = [
      product({ id: 11, type: 'variation', parent: 10, images: [{ src: 'https://shop.example.com/a.jpg', alt: '' }] }),
      product({
        id: 12,
        type: 'variation',
        parent: 10,
        images: [
          { src: 'https://shop.example.com/b.jpg', alt: '' },
          { src: 'http://shop.example.com/insecure.jpg', alt: '' },
        ],
      }),
    ];
    const result = map({ ...catalogOf([variable]), variations: { '10': reads } });
    const images = JSON.parse(result.rows[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as {
      url: string;
      alt: string;
    }[];
    expect(images).toEqual([
      { url: 'https://shop.example.com/a.jpg', alt: 'A' },
      { url: 'https://shop.example.com/b.jpg', alt: 'Shirt' },
    ]);
    expect(result.rows[1]?.extraFields[SOURCE_IMAGE_URLS_FIELD]).toBe(
      result.rows[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD],
    );
    expect(codes(result, 'image_url_invalid')[0]).toMatchObject({ severity: 'dropped', count: 1 });
  });
});

describe('text', () => {
  it('reads titles and descriptions as plain text, with entities decoded and the short description first', () => {
    const result = map(
      catalogOf([
        product({
          name: 'Bitaxe &#8211; Loud &#038; Proud',
          short_description: '<p>Short <strong>pitch</strong>.</p>',
          description: '<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>Long &gt; short</p>',
        }),
      ]),
    );
    expect(result.rows[0]?.title).toBe('Bitaxe – Loud & Proud');
    expect(result.rows[0]?.description).toBe('Short pitch.\n\n• One\n• Two\n\nLong > short');
  });

  it('lists categories beyond the first, tags and brands as tags, and the first category as the category', () => {
    const result = map(
      catalogOf([
        product({
          categories: [{ name: 'Books' }, { name: 'Bitcoin' }],
          tags: [{ name: 'gift' }],
          brands: [{ name: 'Acme' }],
        }),
      ]),
    );
    expect(result.rows[0]).toMatchObject({ category: 'Books', tags: ['Bitcoin', 'gift', 'Acme'] });
    expect(codes(result, 'category_absent')).toHaveLength(0);
    const bare = map(catalogOf([product({ categories: [] })]));
    expect(codes(bare, 'category_absent')).toHaveLength(1);
  });

  it('lists attributes that are not a buyer choice at the end of the description', () => {
    const result = map(
      catalogOf([
        product({
          attributes: [
            { name: 'Material', has_variations: false, terms: [{ name: 'Ceramic' }, { name: 'Glaze' }] },
            { name: 'Size', has_variations: true, terms: [{ name: 'S' }] },
          ],
        }),
      ]),
    );
    expect(result.rows[0]?.description).toBe('A mug.\n\nMaterial: Ceramic, Glaze');
  });
});

describe('purity', () => {
  it('maps the same catalogue to the same rows and report every time, without touching its input', () => {
    const catalog = catalogOf(REAL_PRODUCTS.slice(0, 20));
    const before = JSON.stringify(catalog);
    const first = map(catalog);
    expect(JSON.stringify(map(catalog))).toBe(JSON.stringify(first));
    expect(JSON.stringify(catalog)).toBe(before);
  });
});
