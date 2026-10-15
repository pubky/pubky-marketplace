import { describe, expect, it } from 'vitest';
import type { PresetRow } from './import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS } from './import-settings';
import { buildShopifyPresetRows, shopifyCsvQuantities } from './import-shopify-csv';

const CURRENT = [
  'Title,URL handle,Description,SKU,Option1 name,Option1 value,Price,Inventory quantity',
  'Boots,boots,Warm,BOOT-M,Size,M,125.00,12',
  'Boots,boots,,,Size,L,125.00,',
  'Boots,boots,,BOOT.XL,Size,XL,125.00,3',
  'Hat,hat,Wool,,,,40.00,5',
].join('\n');

const LEGACY = [
  'Handle,Title,Body (HTML),Variant SKU,Option1 Name,Option1 Value,Variant Price,Variant Inventory Qty',
  'old-shirt,Old shirt,Cotton,SHIRT-1,Size,M,20.00,9',
].join('\n');

describe('shopifyCsvQuantities', () => {
  it('keys quantities by handle and the variant id the SDK mapper derives', () => {
    const quantities = shopifyCsvQuantities(CURRENT);
    expect([...(quantities.get('boots') ?? [])]).toEqual([
      ['BOOT-M', '12'],
      ['v2', ''],
      ['BOOT.XL', '3'],
    ]);
    expect([...(quantities.get('hat') ?? [])]).toEqual([['v1', '5']]);
  });

  it('reads the legacy header names and a BOM', () => {
    const quantities = shopifyCsvQuantities(`\uFEFF${LEGACY}`);
    expect([...(quantities.get('old-shirt') ?? [])]).toEqual([['SHIRT-1', '9']]);
  });

  it('returns nothing for text that is not a CSV table', () => {
    expect(shopifyCsvQuantities('').size).toBe(0);
    expect(shopifyCsvQuantities('a,b\n"open').size).toBe(0);
  });
});

function sdkRow(overrides: Partial<PresetRow> = {}): PresetRow {
  return {
    recordUri: `pubky://${'y'.repeat(52)}/pub/pubky.app/marketplace/v1/listings/hat`,
    sellerPubky: 'y'.repeat(52),
    listingId: 'hat',
    sourceListingKey: 'hat',
    recordRevision: 1,
    variantId: 'v1',
    sku: '',
    state: 'active',
    title: 'Hat',
    description: 'Wool',
    taxonomy: {},
    category: 'Hats',
    condition: 'new',
    tags: [],
    amountMinor: 4_000,
    currency: 'USD',
    exponent: 2,
    variantQuantity: 0,
    variantEnabled: true,
    options: {},
    media: [],
    shippingOptions: [],
    returnPolicy: { accepted: false },
    sale: { format: 'fixed_price' },
    externalRefs: { channel: 'shopify', external_id: 'handle:hat', handle: 'hat' },
    extraFields: {},
    ...overrides,
  };
}

describe('buildShopifyPresetRows', () => {
  const base = {
    text: CURRENT,
    products: [{ handle: 'hat', title: 'Hat', images: [], losses: [] }],
    skipped: [],
    headerLosses: [],
    workExponent: 2,
  };

  it('maps SDK condition values the Shop cannot hold to the nearest one and reports it', () => {
    const result = buildShopifyPresetRows({
      ...base,
      rows: [sdkRow({ condition: 'used' })],
      settings: { ...DEFAULT_IMPORT_SETTINGS, useCsvQuantities: true },
    });
    expect(result.rows[0]?.condition).toBe('good');
    expect(result.report.losses.map((loss) => loss.code)).toContain('condition_mapped');
  });

  it('uses the default condition where the SDK had to default it', () => {
    const result = buildShopifyPresetRows({
      ...base,
      products: [{ ...base.products[0]!, losses: [{ code: 'condition_defaulted', source: 'x', detail: 'x' }] }],
      rows: [sdkRow()],
      settings: { ...DEFAULT_IMPORT_SETTINGS, condition: 'fair', useCsvQuantities: true },
    });
    expect(result.rows[0]?.condition).toBe('fair');
    expect(result.report.losses.find((loss) => loss.code === 'condition_defaulted')?.detail).toContain('fair');
  });

  it('reports a missing or invalid CSV quantity as stock 0 instead of failing', () => {
    const result = buildShopifyPresetRows({
      ...base,
      text: 'Title,URL handle,SKU,Price,Inventory quantity\nHat,hat,,40.00,abc',
      rows: [sdkRow()],
      settings: { ...DEFAULT_IMPORT_SETTINGS, useCsvQuantities: true },
    });
    expect(result.rows[0]?.variantQuantity).toBe(0);
    expect(result.rows[0]?.state).toBe('paused');
    expect(result.report.losses.map((loss) => loss.code)).toEqual(
      expect.arrayContaining(['quantity_invalid', 'no_stock_paused']),
    );
  });

  it('only reports a header loss when a row carries data in that column', () => {
    const result = buildShopifyPresetRows({
      ...base,
      text: 'Title,URL handle,SKU,Price,Barcode,Cost per item\nHat,hat,,40.00,123,',
      rows: [sdkRow()],
      headerLosses: [
        { code: 'barcode', source: 'Barcode', detail: 'x' },
        { code: 'cost', source: 'Cost per item', detail: 'x' },
      ],
      settings: DEFAULT_IMPORT_SETTINGS,
    });
    expect(result.report.losses.map((loss) => loss.code)).toContain('barcode');
    expect(result.report.losses.map((loss) => loss.code)).not.toContain('cost');
  });
});
