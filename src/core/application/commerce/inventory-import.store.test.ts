import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { uploadImportImages } from '@/hooks/useImportImageUpload/useImportImageUpload';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import {
  altTextForUrl,
  IMPORT_SOURCE_HASH_KEY,
  type ImportImageResult,
  outcomesFromResults,
  sourceUrlHash,
  uniqueImageUrls,
} from '@/pipes/commerce/import-image-phase';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import type { ImportSettings } from '@/pipes/commerce/import-settings';
import { storeIdKey, type WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const STORE = 'https://dezentralshop.ch';
const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce/store-api');
const CHF: ImportSettings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' };
const OFFERED = ['USD', 'CHF'];

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

const REAL_PRODUCTS = [1, 2, 3].flatMap(
  (page) =>
    JSON.parse(readFileSync(resolve(FIXTURES, `dezentralshop-products-p${page}.json`), 'utf8')) as StoreApiProduct[],
);
const REAL_VARIATIONS = JSON.parse(readFileSync(resolve(FIXTURES, 'dezentralshop-variations.json'), 'utf8')) as Record<
  string,
  StoreApiProduct
>;

const COUNTED = REAL_PRODUCTS.find(
  (entry) => entry.type === 'simple' && entry.is_in_stock && entry.low_stock_remaining === 2,
)!;
const SOLD_OUT = REAL_PRODUCTS.find((entry) => entry.type === 'simple' && !entry.is_in_stock)!;
const ON_SALE = REAL_PRODUCTS.find((entry) => entry.type === 'simple' && entry.on_sale)!;
const FAN = REAL_PRODUCTS.find((entry) => entry.id === 6820)!;
const MINER = REAL_PRODUCTS.find((entry) => entry.id === 5398)!;
const SAMPLE_IDS = [FAN.id, COUNTED.id, SOLD_OUT.id, ON_SALE.id, MINER.id];

function catalogOf(products: readonly StoreApiProduct[], storeUrl = STORE): WooStoreCatalog {
  const variations: Record<string, StoreApiProduct[]> = {};
  for (const product of products) {
    if (product.type !== 'variable') continue;
    variations[String(product.id)] = product.variations.flatMap((ref) =>
      REAL_VARIATIONS[ref.id] ? [REAL_VARIATIONS[ref.id]!] : [],
    );
  }
  return { storeUrl, products, variations, unreadProducts: 0, total: products.length };
}

const sample = (ids: readonly number[] = SAMPLE_IDS) => REAL_PRODUCTS.filter((entry) => ids.includes(entry.id));
const listingIdOf = (productId: number) => `woo-${storeIdKey(STORE)}-${productId}`;

const WITH_METHOD: SellerPaymentConfig = {
  bitcoinAvailable: true,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};
const NO_METHOD: SellerPaymentConfig = { bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: false };

function prepared(params: { url: string; altText: string }, fetchedUrls: readonly string[]): TImportImagePrepareResult {
  const id = `m${fetchedUrls.indexOf(params.url) + 1}`;
  return {
    ok: true,
    fetchedBytes: 1_000,
    bytes: new Uint8Array([1, 2, 3]),
    media: {
      id,
      type: 'image',
      url: CommerceRecordNormalizer.mediaUri(PUBKY, id),
      contentHash: 'a'.repeat(64),
      mimeType: 'image/webp',
      byteSize: 1_000,
      width: 800,
      height: 800,
      altText: params.altText,
    },
  };
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

describe('importing a WooCommerce store catalogue through plan, photos and publish', () => {
  let store: MemoryImportStore;
  let stored: CommerceListingRecord[];
  let puts: CommerceListingRecord[];
  let fetched: string[];
  let payment: SellerPaymentConfig;

  beforeEach(() => {
    store = new MemoryImportStore();
    stored = [];
    puts = [];
    fetched = [];
    payment = WITH_METHOD;
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(async (params) => {
      if (!fetched.includes(params.url)) fetched.push(params.url);
      return prepared(params, fetched);
    });
    vi.spyOn(CommerceController, 'commitCreateMedia').mockImplementation(
      async (id) => `pubky://${PUBKY}/media/${String(id)}`,
    );
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        puts.push(record);
        stored = [...stored.filter((entry) => entry.listingId !== record.listingId), record];
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => payment,
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
  }

  /** The sequence the import hook runs for a store: plan the catalogue, load the photos, publish. */
  async function runStoreImport(
    catalog: WooStoreCatalog,
    settings: ImportSettings = CHF,
    offered: readonly string[] = OFFERED,
  ) {
    const importer = app();
    const planned = await importer.planStoreCatalog(catalog, settings, offered);
    if (planned.status !== 'planned') return { importer, planned, published: null, targets: [] };
    fetched = [];
    const targets = await importer.imageTargets(planned.manifestId);
    const urls = uniqueImageUrls(targets);
    let results: ImportImageResult[] = [];
    if (urls.length > 0) {
      const outcome = await uploadImportImages({
        ownerPubky: PUBKY,
        urls,
        altText: (url) => altTextForUrl(targets, url),
      });
      results = outcome.results.map((result) => ({
        url: result.url,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.media ? { media: JSON.parse(JSON.stringify(result.media)) as PresetJson } : {}),
      }));
    }
    await importer.attachImages(planned.manifestId, outcomesFromResults(targets, results));
    puts = [];
    const published = await importer.publish(planned.manifestId);
    return { importer, planned, published, targets };
  }

  const record = (productId: number) => stored.find((entry) => entry.listingId === listingIdOf(productId));

  describe('the first import', () => {
    it('plans every product as a create, with the store format and a loss report, and nothing published yet', async () => {
      const importer = app();
      const planned = await importer.planStoreCatalog(catalogOf(sample()), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned).toMatchObject({
        format: 'woocommerce_store',
        rowCount: 7,
        counts: { create: 7, update: 0, conflict: 0 },
        publishGate: { reason: null },
      });
      expect(planned.lossReport?.listingsImported).toBe(5);
      expect(planned.lossReport?.losses.map((loss) => loss.code)).toEqual(
        expect.arrayContaining(['stock_not_public', 'stock_from_cart_limit', 'compare_at_price', 'no_stock_paused']),
      );
      expect(puts).toEqual([]);
    });

    it('loads the photos and publishes one listing per product with its price, stock, options and stable id', async () => {
      const { published, targets } = await runStoreImport(catalogOf(sample()));
      expect(targets).toHaveLength(5);
      expect(published).toMatchObject({ status: 'complete', published: 5, failed: 0 });
      expect(new Set(puts.map((entry) => entry.listingId))).toEqual(new Set(SAMPLE_IDS.map(listingIdOf)));

      const fan = record(FAN.id);
      expect(fan).toMatchObject({ state: 'active', title: FAN.name.replace('&#8211;', '–') });
      expect(fan?.sale.format === 'fixed_price' && fan.sale.unitPrice).toMatchObject({
        amountMinor: 1_200,
        currency: 'CHF',
        exponent: 2,
      });
      expect(fan?.variants[0]?.quantity).toBe(12);
      expect(fan?.media).toHaveLength(1);

      expect(record(COUNTED.id)?.variants[0]?.quantity).toBe(2);
      expect(record(SOLD_OUT.id)).toMatchObject({ state: 'paused' });
      expect(record(SOLD_OUT.id)?.variants[0]?.quantity).toBe(0);
      const sale = record(ON_SALE.id)?.sale;
      expect(sale?.format === 'fixed_price' && sale.unitPrice.amountMinor).toBe(Number(ON_SALE.prices?.price));

      const miner = record(MINER.id);
      expect(miner?.variants.map((variant) => variant.options)).toEqual([
        { Hashrate: '110 TH/s' },
        { Hashrate: '115 TH/s' },
        { Hashrate: '120 TH/s' },
      ]);
      expect(miner?.variants.map((variant) => variant.priceOverride?.amountMinor)).toEqual([undefined, 77_900, 79_900]);
    });

    it('records where each photo came from as a hash, and never publishes the store address in a record', async () => {
      await runStoreImport(catalogOf(sample([FAN.id])));
      const fan = record(FAN.id);
      expect(fan?.media.map((media) => (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY])).toEqual(
        [...new Set(FAN.images.map((image) => image.src))].map(sourceUrlHash),
      );
      expect(JSON.stringify(fan?.media)).not.toContain('dezentralshop.ch');
      expect(fetched).toEqual([...new Set(FAN.images.map((image) => image.src))]);
    });

    it('invents no shipping and no ships-from when the seller has chosen neither, and so publishes nothing', async () => {
      const importer = app();
      const none: ImportSettings = { ...CHF, shipping: null, countryCode: null };
      const planned = await importer.planStoreCatalog(catalogOf(sample([FAN.id])), none, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      const rows = [...store.payloads.values()].map(
        (json) => JSON.parse(json) as { shippingOptions: unknown[]; extraFields: Record<string, string> },
      );
      expect(rows.every((row) => row.shippingOptions.length === 0 && row.extraFields.country_code === undefined)).toBe(
        true,
      );
    });
  });

  describe('currency', () => {
    it('refuses a store in a currency the listing form does not offer, with a plain message and nothing planned', async () => {
      const importer = app();
      const planned = await importer.planStoreCatalog(catalogOf(sample()), CHF, ['USD', 'BTC']);
      expect(planned).toEqual({
        status: 'parse-failed',
        message:
          'This store sells in CHF. Pubky listings can be priced in USD, BTC, and prices are never converted. Nothing was imported.',
        puts: 0,
      });
      expect(store.payloads.size).toBe(0);
    });
  });

  describe('importing the same store again', () => {
    it('plans updates for the listings it already holds, never a conflict, and loads no photo twice', async () => {
      await runStoreImport(catalogOf(sample()));
      const { planned, published, targets } = await runStoreImport(catalogOf(sample()));
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned.counts).toMatchObject({ create: 0, conflict: 0 });
      expect(planned.counts.update).toBeGreaterThan(0);
      expect(planned.counts.update + planned.counts.unchanged).toBe(7);
      expect(targets.every((target) => target.images.length === 0)).toBe(true);
      expect(fetched).toEqual([]);
      expect(published).toMatchObject({ status: 'complete', failed: 0 });
      expect(record(FAN.id)?.revision).toBeGreaterThanOrEqual(1);
    });

    it('updates only what the store changed, and loads photos only for a product that is new', async () => {
      await runStoreImport(catalogOf(sample()));
      const before = new Map(stored.map((entry) => [entry.listingId, entry.revision]));
      const changedFan: StoreApiProduct = {
        ...FAN,
        prices: { ...FAN.prices!, price: '1500', regular_price: '1500', sale_price: '1500' },
        add_to_cart: { maximum: 7 },
      };
      const brandNew = { ...COUNTED, id: 999_001, name: 'A product that was just added' };
      const next = [changedFan, ...sample().filter((entry) => entry.id !== FAN.id), brandNew];
      const { planned } = await runStoreImport(catalogOf(next));
      if (planned.status !== 'planned') throw new Error('plan');

      expect(planned.counts.create).toBe(1);
      expect(record(FAN.id)?.revision).toBe((before.get(listingIdOf(FAN.id)) ?? 0) + 1);
      expect(record(FAN.id)?.variants[0]?.quantity).toBe(7);
      const price = record(FAN.id)?.sale;
      expect(price?.format === 'fixed_price' && price.unitPrice.amountMinor).toBe(1_500);
      expect(record(999_001)).toMatchObject({ state: 'active' });
      expect(fetched).toEqual([...new Set(brandNew.images.map((image) => image.src))]);
    });

    it('gives two stores their own listings even when their product ids are the same', async () => {
      await runStoreImport(catalogOf(sample([FAN.id])));
      const { planned } = await runStoreImport(catalogOf(sample([FAN.id]), 'https://other-shop.example.com'));
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned.counts).toMatchObject({ create: 1, update: 0 });
      expect(stored).toHaveLength(2);
    });
  });

  describe('when a publish gate blocks (C16)', () => {
    it('saves new listings paused, keeps a live listing live with its content updated, and says so', async () => {
      await runStoreImport(catalogOf(sample([FAN.id])));
      expect(record(FAN.id)?.state).toBe('active');

      payment = NO_METHOD;
      const renamedFan: StoreApiProduct = { ...FAN, name: 'Avalon Q fan, new revision' };
      const { importer, planned, published } = await runStoreImport(catalogOf([renamedFan, COUNTED]));
      if (planned.status !== 'planned') throw new Error('plan');

      expect(planned.publishGate).toMatchObject({
        reason: 'no-method',
        pausing: 1,
        keptLive: [{ listingId: listingIdOf(FAN.id) }],
      });
      expect(published).toMatchObject({ status: 'complete', keptLive: 1, keptLiveReason: 'no-method', paused: 1 });
      expect(record(FAN.id)).toMatchObject({ state: 'active', title: 'Avalon Q fan, new revision' });
      expect(record(COUNTED.id)?.state).toBe('paused');
      if (published?.status !== 'complete') throw new Error('publish');
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain('kept live; fix payment method to keep publishing');
    });

    it('keeps the live listing package when the store sends none', async () => {
      await runStoreImport(catalogOf(sample([FAN.id])));
      const realPackage = { weightGrams: 1_234, lengthMillimeters: 310, widthMillimeters: 205, heightMillimeters: 95 };
      stored = stored.map((entry) => ({ ...entry, package: realPackage }));
      payment = NO_METHOD;
      await runStoreImport(catalogOf([{ ...FAN, name: 'Avalon Q fan again' }]));
      expect(record(FAN.id)).toMatchObject({ state: 'active', package: realPackage });
    });
  });

  describe('a store the seller can read but the file path cannot', () => {
    it('is not planned from a file: the plan takes the catalogue, so a canonical file keeps working as before', async () => {
      const importer = app();
      const file = new BytesFile(new TextEncoder().encode('[]'), 'empty.json', 'application/json');
      const planned = await importer.planFile(file, CHF);
      expect(planned.status).toBe('planned');
    });
  });
});
