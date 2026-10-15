import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { SOURCE_IMAGE_URLS_FIELD } from '@/pipes/commerce/import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS, type ImportSettings } from '@/pipes/commerce/import-settings';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const FIXTURES = resolve(__dirname, '../../../test/fixtures');

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://staging-api.pubky.app',
    isDurableCommerceMode: () => true,
  };
});

vi.mock('@/services/marketplace/marketplace-session', () => ({
  MarketplaceSessionService: {
    getActiveSession: () => ({ token: 'identity', pubky: PUBKY, capabilities: '', expiresAt: Date.now() + 60_000 }),
  },
}));

vi.mock('@/services/marketplace/marketplace-inventory-session', () => ({
  MarketplaceInventorySessionService: {
    getCoveringBearer: (sellerPubky: string) =>
      sellerPubky === PUBKY ? { token: 'inventory', source: 'inventory' } : null,
  },
}));

type PayloadRow = {
  listingId: string;
  variantId: string;
  sku: string;
  state: string;
  title: string;
  amountMinor: number;
  currency: string;
  exponent: number;
  variantQuantity: number;
  options: Record<string, string>;
  shippingOptions: unknown[];
  extraFields: Record<string, string>;
};

function bytesOf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, path)));
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function syncAll(listings: readonly { listing_id: string }[]): { readonly ok: true; readonly value: SyncManyEnvelope } {
  return {
    ok: true,
    value: asOpaque<SyncManyEnvelope>({
      schema_version: BigInt(1),
      kind: 'listing.sync_many',
      results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
    }),
  };
}

describe('shop-system CSV presets through plan, dry-run and publish', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () => ({}),
      putListing: async (record) => {
        puts.push(record);
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
    });
  }

  function payloads(): PayloadRow[] {
    return [...store.payloads.values()].map((value) => JSON.parse(value) as PayloadRow);
  }

  /** Stands in for the image-fetch follow-up: attaches already-uploaded media to the planned rows. */
  function attachPhotos(listingIds: readonly string[]) {
    const media = JSON.stringify(createCommerceListingFixture().media);
    for (const [key, value] of store.payloads) {
      const row = JSON.parse(value) as PayloadRow;
      if (!listingIds.includes(row.listingId)) continue;
      store.payloads.set(key, JSON.stringify({ ...row, extraFields: { ...row.extraFields, media_json: media } }));
    }
  }

  describe('WooCommerce', () => {
    it('plans the official sample export with the loss report in the dry run', async () => {
      const result = await app().planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'sample_products.csv', 'text/csv'),
      );
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(result.format).toBe('woocommerce');
      expect(result.rowCount).toBe(21);
      expect(result.counts).toEqual({ create: 21, update: 0, end: 0, unchanged: 0, conflict: 0 });
      expect(result.lossReport).toMatchObject({ listingsRead: 18, listingsImported: 16, listingsSkipped: 2 });
      expect(result.lossReport?.losses.some((loss) => loss.code === 'unsupported_type')).toBe(true);
      expect(puts).toEqual([]);
    });

    it('plans the semicolon + BOM variant to the same rows and the same report', async () => {
      const comma = await app().planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'a.csv', 'text/csv'),
      );
      const semicolon = await app().planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.semicolon-bom.csv'), 'b.csv', 'text/csv'),
      );
      expect(comma.status === 'planned' && semicolon.status === 'planned').toBe(true);
      if (comma.status !== 'planned' || semicolon.status !== 'planned') return;
      expect(semicolon.format).toBe('woocommerce');
      expect(semicolon.rowCount).toBe(comma.rowCount);
      expect(semicolon.lossReport).toEqual(comma.lossReport);
    });

    it('persists variants, stock, prices and source image URLs in the planned rows', async () => {
      await app().planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'sample_products.csv', 'text/csv'),
      );
      const tee = payloads().filter((row) => row.listingId === 'woo-vneck-tee');
      expect(tee.map((row) => row.sku).sort()).toEqual([
        'woo-vneck-tee-blue',
        'woo-vneck-tee-green',
        'woo-vneck-tee-red',
      ]);
      expect(tee.every((row) => row.amountMinor === 1_500 && row.currency === 'USD' && row.exponent === 2)).toBe(true);
      expect(tee.every((row) => row.variantQuantity === 1)).toBe(true);
      expect(JSON.parse(tee[0]?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]')).toHaveLength(3);
    });

    it('applies the import settings to every row', async () => {
      const settings: ImportSettings = {
        ...DEFAULT_IMPORT_SETTINGS,
        currency: 'CHF',
        countryCode: 'CH',
        condition: 'good',
        shipping: { mode: 'flat', priceMinor: 790, minDays: 2, maxDays: 4 },
        unmanagedStock: 3,
      };
      await app().planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'sample_products.csv', 'text/csv'),
        settings,
      );
      const rows = payloads();
      expect(rows.every((row) => row.currency === 'CHF' && row.exponent === 2)).toBe(true);
      expect(rows.every((row) => row.extraFields.country_code === 'CH')).toBe(true);
      expect(rows.every((row) => row.variantQuantity === 3)).toBe(true);
      expect(rows[0]?.shippingOptions).toEqual([
        {
          id: 'standard',
          pricing: 'flat',
          label: 'Standard shipping',
          price: { amountMinor: 790, currency: 'CHF', exponent: 2 },
          estimatedMinDays: 2,
          estimatedMaxDays: 4,
        },
      ]);
    });

    it('fails per listing, not per file: bad rows are reported and the rest are planned', async () => {
      const text = [
        'ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price',
        '1,simple,ok,Good item,1,Fine,1,4,10.00',
        '2,simple,bad,Bad price,1,Fine,1,4,ten',
        '3,grouped,grp,Group,1,Fine,1,,',
      ].join('\n');
      const result = await app().planFile(new BytesFile(utf8(text), 'mixed.csv', 'text/csv'));
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(result.rowCount).toBe(1);
      expect(result.lossReport?.losses.filter((loss) => loss.severity === 'skipped')).toHaveLength(2);
    });

    it('plans an export with nothing importable as an empty dry run that explains why', async () => {
      const text = 'ID,Type,SKU,Name,Regular price\n1,grouped,grp,Group,\n';
      const result = await app().planFile(new BytesFile(utf8(text), 'none.csv', 'text/csv'));
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(result.rowCount).toBe(0);
      expect(result.counts.create).toBe(0);
      expect(result.lossReport?.listingsSkipped).toBe(1);
    });

    it('reads a Windows-1252 export and says so', async () => {
      const latin1 = Uint8Array.from(
        [...'ID;Type;SKU;Name;Regular price\r\n1;simple;caf;Caf\u00e9 Creme;4,50\r\n'].map((character) =>
          character.charCodeAt(0),
        ),
      );
      const result = await app().planFile(new BytesFile(latin1, 'excel.csv', 'text/csv'), {
        ...DEFAULT_IMPORT_SETTINGS,
        currency: 'EUR',
      });
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(payloads()[0]).toMatchObject({ title: 'Café Creme', amountMinor: 450, currency: 'EUR' });
      expect(result.lossReport?.losses.some((loss) => loss.code === 'encoding_fallback')).toBe(true);
    });

    it('refuses a Woo file with an unterminated quote before planning anything', async () => {
      const result = await app().planFile(
        new BytesFile(utf8('ID,Type,SKU,Name,Regular price\n1,simple,a,"Open,5\n'), 'bad.csv', 'text/csv'),
      );
      expect(result.status).toBe('parse-failed');
      expect(store.manifests.size).toBe(0);
    });

    it('needs the preset configuration to plan a shop-system file at all', async () => {
      const planned = await MarketplaceShopClientService.planBrowserFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'a.csv', 'text/csv'),
        store,
      );
      expect(planned.ok).toBe(false);
      expect(store.manifests.size).toBe(0);
    });

    it('publishes listings that have photos and reports the ones that do not, without stopping', async () => {
      const importer = app();
      const planned = await importer.planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'sample_products.csv', 'text/csv'),
      );
      expect(planned.status).toBe('planned');
      if (planned.status !== 'planned') return;
      attachPhotos(['woo-vneck-tee', 'woo-polo']);

      const published = await importer.publish(planned.manifestId);

      expect(published.status).toBe('complete');
      if (published.status !== 'complete') return;
      expect(puts.map((record) => record.listingId).sort()).toEqual(['woo-polo', 'woo-vneck-tee']);
      expect(published.published).toBe(2);
      expect(published.synced).toBe(4);
      expect(published.failed).toBe(17);
      expect(published.mixed).toBe(true);
      expect(published.message).toMatch(/^14 listings need a photo/);

      const tee = puts.find((record) => record.listingId === 'woo-vneck-tee');
      expect(tee?.variants.map((variant) => variant.priceOverride?.amountMinor)).toEqual([2_000, 2_000, undefined]);
      expect(tee?.variants.map((variant) => variant.options)).toEqual([
        { Color: 'Red' },
        { Color: 'Green' },
        { Color: 'Blue' },
      ]);
      expect(tee).toMatchObject({
        state: 'active',
        condition: 'new',
        location: { countryCode: 'US' },
        fulfillmentMethods: ['physical'],
      });
      expect(tee?.shippingOptions).toHaveLength(1);

      const result = await importer.resultCsv(planned.manifestId);
      expect(result).toContain('"photo_required"');
      expect(result).toContain('"synced"');
    });

    it('fails every listing with a photo reason, and still finishes, when no photos are attached', async () => {
      const importer = app();
      const planned = await importer.planFile(
        new BytesFile(bytesOf('woocommerce/sample_products.csv'), 'sample_products.csv', 'text/csv'),
      );
      if (planned.status !== 'planned') throw new Error('plan');
      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 0, synced: 0, failed: 21, mixed: false });
      expect(puts).toEqual([]);
    });
  });

  describe('Shopify', () => {
    const shopify = () => new BytesFile(bytesOf('shopify/product-current.csv'), 'product-current.csv', 'text/csv');

    it('keeps stock at 0 by default, pauses the listing and reports why', async () => {
      const result = await app().planFile(shopify());
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(result.format).toBe('shopify');
      expect(payloads().map((row) => [row.variantQuantity, row.state])).toEqual([
        [0, 'paused'],
        [0, 'paused'],
      ]);
      const codes = result.lossReport?.losses.map((loss) => loss.code) ?? [];
      expect(codes).toEqual(
        expect.arrayContaining(['csv_quantity_unscoped', 'no_stock_paused', 'unpublished_product']),
      );
    });

    it('applies the CSV quantities as total stock when the toggle is on', async () => {
      const result = await app().planFile(shopify(), { ...DEFAULT_IMPORT_SETTINGS, useCsvQuantities: true });
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      const rows = payloads();
      expect(rows.map((row) => [row.sku, row.variantQuantity, row.state]).sort()).toEqual([
        ['BOOT-L', 7, 'active'],
        ['BOOT-M', 12, 'active'],
      ]);
      expect(rows.map((row) => row.options)).toEqual(expect.arrayContaining([{ Size: 'M' }, { Size: 'L' }]));
      const codes = result.lossReport?.losses.map((loss) => loss.code) ?? [];
      expect(codes).not.toContain('csv_quantity_unscoped');
      expect(codes).not.toContain('no_stock_paused');
    });

    it('stops forcing USD: the listing currency, exponent and whole-yen prices follow the settings', async () => {
      await app().planFile(shopify(), { ...DEFAULT_IMPORT_SETTINGS, currency: 'EUR', useCsvQuantities: true });
      expect(
        payloads().every((row) => row.currency === 'EUR' && row.exponent === 2 && row.amountMinor === 12_500),
      ).toBe(true);

      store = new MemoryImportStore();
      await app().planFile(shopify(), { ...DEFAULT_IMPORT_SETTINGS, currency: 'JPY', useCsvQuantities: true });
      expect(payloads().every((row) => row.currency === 'JPY' && row.exponent === 0 && row.amountMinor === 125)).toBe(
        true,
      );
    });

    it('skips a product whose price is not a whole amount in the chosen currency, and plans the rest', async () => {
      const text = [
        'Title,URL handle,Description,Vendor,Product category,Type,Tags,Published on online store,Status,SKU,Option1 name,Option1 value,Price,Inventory quantity',
        'Fine hat,fine-hat,Warm,Acme,Hats,Hats,,true,active,HAT-1,Size,M,150.00,5',
        'Odd hat,odd-hat,Warm,Acme,Hats,Hats,,true,active,HAT-2,Size,M,150.50,5',
      ].join('\n');
      const result = await app().planFile(new BytesFile(utf8(text), 'hats.csv', 'text/csv'), {
        ...DEFAULT_IMPORT_SETTINGS,
        currency: 'JPY',
        useCsvQuantities: true,
      });
      expect(result.status).toBe('planned');
      if (result.status !== 'planned') return;
      expect(payloads().map((row) => row.listingId)).toEqual(['fine-hat']);
      expect(result.lossReport?.losses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'price_scale', severity: 'skipped', listing: 'Odd hat' }),
        ]),
      );
    });

    it('keeps the source image URLs in the row and reports them as not loaded', async () => {
      const result = await app().planFile(shopify(), { ...DEFAULT_IMPORT_SETTINGS, useCsvQuantities: true });
      if (result.status !== 'planned') throw new Error('plan');
      const first = payloads()[0];
      expect(JSON.parse(first?.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]')).toEqual([
        { url: 'https://cdn.shopify.com/s/files/shirt.png', alt: 'front' },
      ]);
      expect(result.lossReport?.losses).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'image_not_loaded', listing: 'Night Boots' })]),
      );
    });

    it('surfaces the SDK loss codes, and drops the two that no longer apply', async () => {
      const result = await app().planFile(shopify(), { ...DEFAULT_IMPORT_SETTINGS, useCsvQuantities: true });
      if (result.status !== 'planned') throw new Error('plan');
      const codes = new Set(result.lossReport?.losses.map((loss) => loss.code));
      for (const code of ['html_body', 'compare_at_price', 'cost', 'barcode', 'seo', 'weight', 'tax', 'collection']) {
        expect(codes.has(code)).toBe(true);
      }
      expect(codes.has('shipping_price_absent')).toBe(false);
      expect(codes.has('image_src_requires_seller_download')).toBe(false);
    });

    it('applies the default shipping option and country, and publishes once a photo is attached', async () => {
      const importer = app();
      const planned = await importer.planFile(shopify(), {
        ...DEFAULT_IMPORT_SETTINGS,
        useCsvQuantities: true,
        countryCode: 'CH',
        condition: 'excellent',
      });
      if (planned.status !== 'planned') throw new Error('plan');
      attachPhotos(['night-boots']);
      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 1, synced: 2, failed: 0 });
      expect(puts[0]).toMatchObject({
        listingId: 'night-boots',
        condition: 'excellent',
        location: { countryCode: 'CH' },
        state: 'active',
      });
      expect(puts[0]?.variants.map((variant) => variant.quantity).sort((a, b) => a - b)).toEqual([7, 12]);
      expect(puts[0]?.shippingOptions?.[0]).toMatchObject({ pricing: 'free' });
    });
  });
});
