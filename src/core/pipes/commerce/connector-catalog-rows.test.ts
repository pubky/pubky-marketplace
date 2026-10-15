import { describe, expect, it } from 'vitest';
import { type ConnectorCatalogProduct, connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import {
  connectorListingId,
  connectorMappingsFor,
  connectorStoreCurrency,
  connectorVariantId,
  mapConnectorCatalog,
} from './connector-catalog-rows';
import { DEFAULT_IMPORT_SETTINGS, type ImportSettings } from './import-settings';

const SELLER = 'y'.repeat(52);

const CHOSEN: ImportSettings = {
  ...DEFAULT_IMPORT_SETTINGS,
  currency: 'CHF',
  countryCode: 'CH',
  shipping: { mode: 'free', minDays: 3, maxDays: 10 },
};

function product(overrides: Record<string, unknown> = {}): ConnectorCatalogProduct {
  return connectorCatalogProductSchema.parse({
    providerProductId: '7718',
    title: 'The Little Hodler Socks Bundle',
    description: '<p>Warm socks &amp; a <strong>sticker</strong>.</p>',
    imageUrls: ['https://dezentralshop.ch/wp-content/uploads/socks.jpg'],
    options: [{ name: 'Size', values: ['S', 'M'] }],
    variants: [
      {
        providerVariantId: '7719',
        sku: 'SOCK-S',
        optionValues: [{ name: 'Size', value: 'S' }],
        price: { amountMinor: 2500, currency: 'CHF', exponent: 2 },
        stock: 8,
      },
      {
        providerVariantId: '7720',
        sku: 'SOCK-M',
        optionValues: [{ name: 'Size', value: 'M' }],
        price: { amountMinor: 3000, currency: 'CHF', exponent: 2 },
        stock: 0,
      },
    ],
    ...overrides,
  });
}

function simple(id: string, overrides: Record<string, unknown> = {}): ConnectorCatalogProduct {
  return connectorCatalogProductSchema.parse({
    providerProductId: id,
    title: `Simple product ${id}`,
    imageUrls: [],
    variants: [
      {
        providerVariantId: `${id}1`,
        sku: `SKU-${id}`,
        price: { amountMinor: 1800, currency: 'CHF', exponent: 2 },
        stock: 5,
      },
    ],
    ...overrides,
  });
}

function mapped(
  products: ConnectorCatalogProduct[],
  settings = CHOSEN,
  provider: 'woocommerce' | 'shopify' = 'woocommerce',
) {
  return mapConnectorCatalog({ products, provider, sellerPubky: SELLER, settings });
}

describe('ids', () => {
  it('derives stable, path-safe ids from the store ids', () => {
    expect(connectorListingId('woocommerce', '7718')).toBe('woo-7718');
    expect(connectorListingId('shopify', 'gid://shopify/Product/42')).toBe('shopify-42');
    expect(connectorVariantId('gid://shopify/ProductVariant/99')).toBe('v99');
    expect(connectorVariantId('7719')).toBe('v7719');
    expect(connectorListingId('woocommerce', 'a b/ü?')).toMatch(/^woo-[A-Za-z0-9_-]+$/);
  });
});

describe('mapConnectorCatalog', () => {
  it('maps a variable product to one row per variant under one listing', () => {
    const { rows, report, links } = mapped([product()]);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.listingId))).toEqual(new Set(['woo-7718']));
    const [small, medium] = rows;
    expect(small).toMatchObject({
      recordUri: `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/woo-7718`,
      sellerPubky: SELLER,
      sourceListingKey: 'woocommerce:7718',
      variantId: 'v7719',
      sku: 'SOCK-S',
      title: 'The Little Hodler Socks Bundle',
      description: 'Warm socks & a sticker.',
      amountMinor: 2500,
      currency: 'CHF',
      exponent: 2,
      variantQuantity: 8,
      options: { Size: 'S' },
      state: 'active',
      category: '',
      returnPolicy: { accepted: false },
    });
    expect(medium).toMatchObject({ variantId: 'v7720', variantQuantity: 0, options: { Size: 'M' } });
    expect(medium?.extraFields.variant_price_minor).toBe('3000');
    expect(small?.extraFields.variant_price_minor).toBeUndefined();
    expect(small?.extraFields.external_variant_id).toBe('woocommerce:7719');
    expect(small?.externalRefs).toEqual({ channel: 'woocommerce', external_id: 'woocommerce:7718' });
    expect(links).toEqual([
      {
        listingId: 'woo-7718',
        variantId: 'v7719',
        providerProductId: '7718',
        providerVariantId: '7719',
        sku: 'SOCK-S',
      },
      {
        listingId: 'woo-7718',
        variantId: 'v7720',
        providerProductId: '7718',
        providerVariantId: '7720',
        sku: 'SOCK-M',
      },
    ]);
    expect(report).toMatchObject({ format: 'woocommerce', listingsRead: 1, listingsImported: 1, listingsSkipped: 0 });
  });

  it('prices the listing at its cheapest variant and keeps each variant price', () => {
    const { rows } = mapped([product()]);
    expect(rows.map((row) => row.amountMinor)).toEqual([2500, 2500]);
  });

  it('carries the photo links for the photo step, https only', () => {
    const { rows, report } = mapped([
      product({
        imageUrls: ['https://shop.example/a.jpg', 'http://shop.example/b.jpg', 'https://shop.example/a.jpg', 'nope'],
      }),
    ]);
    expect(JSON.parse(rows[0]?.extraFields.source_image_urls ?? '[]')).toEqual([
      { url: 'https://shop.example/a.jpg', alt: 'The Little Hodler Socks Bundle' },
    ]);
    expect(report.losses.find((entry) => entry.code === 'image_url_invalid')?.count).toBe(2);
    expect(report.losses.some((entry) => entry.code === 'image_not_loaded')).toBe(true);
  });

  it('drops photos beyond what a listing holds and says so', () => {
    const urls = Array.from({ length: 15 }, (_, index) => `https://shop.example/${index}.jpg`);
    const { rows, report } = mapped([product({ imageUrls: urls })]);
    expect(JSON.parse(rows[0]?.extraFields.source_image_urls ?? '[]')).toHaveLength(12);
    expect(report.losses.find((entry) => entry.code === 'image_overflow')?.count).toBe(3);
  });

  it('puts the seller default quantity on a variant whose stock the store does not track, and says so', () => {
    const untracked = simple('1', {
      variants: [
        { providerVariantId: '11', sku: 'A', price: { amountMinor: 1800, currency: 'CHF', exponent: 2 }, stock: null },
        { providerVariantId: '12', sku: 'B', price: { amountMinor: 1800, currency: 'CHF', exponent: 2 }, stock: 3 },
      ],
    });
    const { rows, report } = mapped([untracked], { ...CHOSEN, unmanagedStock: 4 });

    expect(rows.map((row) => row.variantQuantity)).toEqual([4, 3]);
    const note = report.losses.find((entry) => entry.code === 'stock_unmanaged');
    expect(note).toMatchObject({
      severity: 'changed',
      detail: 'Stock unknown, set to 4.',
      listing: 'Simple product 1',
    });
  });

  it('counts several untracked variants in one note', () => {
    const untracked = simple('1', {
      variants: [
        { providerVariantId: '11', price: { amountMinor: 100, currency: 'CHF', exponent: 2 }, stock: null },
        { providerVariantId: '12', price: { amountMinor: 100, currency: 'CHF', exponent: 2 }, stock: null },
      ],
    });
    const note = mapped([untracked]).report.losses.find((entry) => entry.code === 'stock_unmanaged');
    expect(note).toMatchObject({ detail: 'Stock unknown, set to 1. (2 variants)', count: 2 });
  });

  it('never invents a shipping option or a ships-from country', () => {
    const { rows } = mapped([simple('1')], { ...CHOSEN, shipping: null, countryCode: null });
    expect(rows[0]?.shippingOptions).toEqual([]);
    expect(rows[0]?.extraFields.country_code).toBeUndefined();
  });

  it('uses the seller chosen shipping and ships-from on every row', () => {
    const { rows } = mapped([simple('1'), simple('2')], {
      ...CHOSEN,
      countryCode: 'DE',
      shipping: { mode: 'flat', priceMinor: 990, minDays: 2, maxDays: 5 },
    });
    expect(rows.every((row) => row.extraFields.country_code === 'DE')).toBe(true);
    expect(rows[0]?.shippingOptions).toEqual([
      {
        id: 'standard',
        pricing: 'flat',
        label: 'Standard shipping',
        price: { amountMinor: 990, currency: 'CHF', exponent: 2 },
        estimatedMinDays: 2,
        estimatedMaxDays: 5,
      },
    ]);
  });

  it('drops the Shopify default title option on a single-variant product', () => {
    const { rows } = mapped(
      [
        simple('9', {
          variants: [
            {
              providerVariantId: 'gid://shopify/ProductVariant/91',
              optionValues: [{ name: 'Title', value: 'Default Title' }],
              price: { amountMinor: 500, currency: 'CHF', exponent: 2 },
              stock: 2,
            },
          ],
        }),
      ],
      CHOSEN,
      'shopify',
    );
    expect(rows[0]?.options).toEqual({});
    expect(rows[0]?.listingId).toBe('shopify-9');
    expect(rows[0]?.variantId).toBe('v91');
  });

  it('keeps a real Title option when the product has several variants', () => {
    const { rows } = mapped([
      product({
        variants: [
          {
            providerVariantId: '1',
            optionValues: [{ name: 'Title', value: 'Default Title' }],
            price: { amountMinor: 500, currency: 'CHF', exponent: 2 },
            stock: 1,
          },
          {
            providerVariantId: '2',
            optionValues: [{ name: 'Title', value: 'Large' }],
            price: { amountMinor: 500, currency: 'CHF', exponent: 2 },
            stock: 1,
          },
        ],
      }),
    ]);
    expect(rows.map((row) => row.options)).toEqual([{ Title: 'Default Title' }, { Title: 'Large' }]);
  });

  it('skips a product priced in another currency instead of converting', () => {
    const euro = simple('3', {
      variants: [{ providerVariantId: '31', price: { amountMinor: 1000, currency: 'EUR', exponent: 2 }, stock: 1 }],
    });
    const { rows, report } = mapped([simple('1'), euro]);
    expect(rows.map((row) => row.listingId)).toEqual(['woo-1']);
    expect(report.losses.find((entry) => entry.code === 'price_currency')).toMatchObject({
      severity: 'skipped',
      listing: 'Simple product 3',
    });
    expect(report).toMatchObject({ listingsRead: 2, listingsImported: 1, listingsSkipped: 1 });
  });

  it('rescales a price the store gives at another exponent', () => {
    const yen = mapped(
      [
        simple('5', {
          variants: [
            { providerVariantId: '51', price: { amountMinor: 123400, currency: 'JPY', exponent: 2 }, stock: 1 },
          ],
        }),
      ],
      { ...CHOSEN, currency: 'JPY' },
    );
    expect(yen.rows[0]).toMatchObject({ amountMinor: 1234, currency: 'JPY', exponent: 0 });
  });

  it('skips a price that would lose digits at the currency exponent', () => {
    const { rows, report } = mapped(
      [
        simple('5', {
          variants: [
            { providerVariantId: '51', price: { amountMinor: 123456, currency: 'JPY', exponent: 2 }, stock: 1 },
          ],
        }),
      ],
      { ...CHOSEN, currency: 'JPY' },
    );
    expect(rows).toEqual([]);
    expect(report.losses[0]).toMatchObject({ code: 'price_scale', severity: 'skipped' });
  });

  it('skips a zero price and an unpriceable one, and a product with no variants', () => {
    const zero = simple('6', {
      variants: [{ providerVariantId: '61', price: { amountMinor: 0, currency: 'CHF', exponent: 2 }, stock: 1 }],
    });
    const none = simple('7', { variants: [] });
    const { rows, report } = mapped([zero, none, simple('8')]);
    expect(rows.map((row) => row.listingId)).toEqual(['woo-8']);
    expect(report.losses.map((entry) => entry.code)).toEqual(expect.arrayContaining(['price_zero', 'no_variants']));
  });

  it('skips a product with more variants than a listing holds', () => {
    const many = simple('10', {
      variants: Array.from({ length: 101 }, (_, index) => ({
        providerVariantId: `v${index}`,
        price: { amountMinor: 100, currency: 'CHF', exponent: 2 },
        stock: 1,
      })),
    });
    const { rows, report } = mapped([many]);
    expect(rows).toEqual([]);
    expect(report.losses[0]).toMatchObject({ code: 'variants_overflow', severity: 'skipped' });
  });

  it('reads a product the store repeats once', () => {
    const { rows, report } = mapped([simple('1'), simple('1')]);
    expect(rows).toHaveLength(1);
    expect(report.losses.some((entry) => entry.code === 'product_duplicate')).toBe(true);
  });

  it('pauses a listing with no stock in any variant', () => {
    const { rows, report } = mapped([
      simple('2', {
        variants: [{ providerVariantId: '21', price: { amountMinor: 100, currency: 'CHF', exponent: 2 }, stock: 0 }],
      }),
    ]);
    expect(rows[0]?.state).toBe('paused');
    expect(report.losses.some((entry) => entry.code === 'no_stock_paused')).toBe(true);
  });

  it('gives only imported products a link', () => {
    const { links } = mapped([simple('1'), simple('2', { title: 'x' })]);
    expect(links.map((link) => link.providerProductId)).toEqual(['1']);
  });

  it('notes what every imported listing lacks, once', () => {
    const { report } = mapped([simple('1'), simple('2')]);
    const codes = report.losses.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['category_absent', 'condition_defaulted', 'return_policy_absent']));
    expect(report.losses.find((entry) => entry.code === 'category_absent')?.count).toBe(2);
  });

  it('reports nothing imported for an empty selection', () => {
    const { rows, report } = mapped([]);
    expect(rows).toEqual([]);
    expect(report).toMatchObject({ listingsRead: 0, listingsImported: 0, losses: [] });
  });

  it('is deterministic', () => {
    expect(mapped([product(), simple('2')])).toEqual(mapped([product(), simple('2')]));
  });
});

describe('connectorStoreCurrency', () => {
  it('reads the currency of the first priced variant', () => {
    expect(connectorStoreCurrency([simple('1')])).toBe('CHF');
    expect(connectorStoreCurrency([simple('2', { variants: [] }), simple('1')])).toBe('CHF');
    expect(connectorStoreCurrency([])).toBeNull();
  });
});

describe('connectorMappingsFor', () => {
  it('gives one mapping per imported variant, leaving out an empty SKU', () => {
    expect(
      connectorMappingsFor([
        { listingId: 'woo-1', variantId: 'v11', providerProductId: '1', providerVariantId: '11', sku: 'A' },
        { listingId: 'woo-2', variantId: 'v21', providerProductId: '2', providerVariantId: '21', sku: null },
      ]),
    ).toEqual([
      { listingId: 'woo-1', variantId: 'v11', providerProductId: '1', providerVariantId: '11', sku: 'A' },
      { listingId: 'woo-2', variantId: 'v21', providerProductId: '2', providerVariantId: '21' },
    ]);
  });
});
