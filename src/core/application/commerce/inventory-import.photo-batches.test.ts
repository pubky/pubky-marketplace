import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { IMPORT_IMAGE_MAX_COUNT } from '@/config/import-image';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { IMPORT_SOURCE_HASH_KEY, sourceUrlHash } from '@/pipes/commerce/import-image-phase';
import type { ImportSettings } from '@/pipes/commerce/import-settings';
import type { WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
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

const realCatalog = (): WooStoreCatalog => {
  const variations: Record<string, StoreApiProduct[]> = {};
  for (const product of REAL_PRODUCTS) {
    if (product.type !== 'variable') continue;
    variations[String(product.id)] = product.variations.flatMap((ref) =>
      REAL_VARIATIONS[ref.id] ? [REAL_VARIATIONS[ref.id]!] : [],
    );
  }
  return {
    storeUrl: 'https://dezentralshop.ch',
    products: REAL_PRODUCTS,
    variations,
    unreadProducts: 0,
    total: REAL_PRODUCTS.length,
  };
};

const syncAll = (listings: readonly { listing_id: string }[]) => ({
  ok: true as const,
  value: asOpaque<SyncManyEnvelope>({
    schema_version: BigInt(1),
    kind: 'listing.sync_many',
    results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
  }),
});

function wooCsv(products: number, photosEach: number): BytesFile {
  const rows = Array.from({ length: products }, (_, index) => {
    const images = Array.from(
      { length: photosEach },
      (_, photo) => `https://shop.example.com/p/${index}/${photo}.jpg`,
    ).join(', ');
    return `${index + 1},simple,sku-${index},"Product ${index}",1,Described,1,5,10,Things,"${images}"`;
  });
  const text = ['ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price,Categories,Images', ...rows].join(
    '\n',
  );
  return new BytesFile(new TextEncoder().encode(text), 'products.csv', 'text/csv');
}

describe('photos in batches, through plan, photo phase and publish', () => {
  let store: MemoryImportStore;
  let stored: CommerceListingRecord[];
  let puts: CommerceListingRecord[];
  let fetched: string[];

  beforeEach(() => {
    store = new MemoryImportStore();
    stored = [];
    puts = [];
    fetched = [];
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(async (params) => {
      fetched.push(params.url);
      const id = `m${fetched.length}`;
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
      } satisfies TImportImagePrepareResult;
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
      loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
  }

  /** What the import hook runs for the photo phase, against the real application and its stored rows. */
  const photoPhase = (importer: CommerceInventoryImportApplication, manifestId: string, signal?: AbortSignal) =>
    runImportImageBatches({
      ownerPubky: PUBKY,
      loadTargets: () => importer.imageTargets(manifestId),
      knownMedia: (urls) => importer.knownMedia(manifestId, urls),
      attach: (outcomes) => importer.attachImages(manifestId, outcomes),
      signal,
    });

  describe('the dry run', () => {
    it('says how many photos and batches the real Dezentralshop catalogue will take: 725 photos, 2 batches', async () => {
      const planned = await app().planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned.photos).toEqual({ count: 725, batches: 2, pauses: 1 });
    });

    it('says the same for a WooCommerce CSV: 650 photos are 2 batches, 500 are 1, and a file without photos says nothing', async () => {
      const csv = async (products: number, photos: number) => {
        const planned = await app().planFile(wooCsv(products, photos), CHF);
        if (planned.status !== 'planned') throw new Error('plan');
        return planned.photos;
      };
      expect(await csv(130, 5)).toEqual({ count: 650, batches: 2, pauses: 1 });
      expect(await csv(100, 5)).toEqual({ count: 500, batches: 1, pauses: 0 });
      expect(await csv(3, 0)).toBeUndefined();
    });

    it('counts only the photos still to load: unchanged photos on a stored listing are not counted', async () => {
      const first = await app().planFile(wooCsv(3, 2), CHF);
      if (first.status !== 'planned') throw new Error('plan');
      await photoPhase(app(), first.manifestId);
      await app().publish(first.manifestId);
      const again = await app().planFile(wooCsv(3, 2), CHF);
      if (again.status !== 'planned') throw new Error('plan');
      expect(again.photos).toBeUndefined();
    });
  });

  describe('the real catalogue', () => {
    it('loads all 725 photos in two batches without a second import, and publishes every listing with photos', async () => {
      const importer = app();
      const planned = await importer.planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');

      const run = await photoPhase(importer, planned.manifestId);
      expect(run).toEqual({ status: 'complete', remaining: 0, done: 725, total: 725 });
      expect(fetched).toHaveLength(725);
      expect(new Set(fetched).size).toBe(725);

      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 279, failed: 0 });
      expect(stored).toHaveLength(279);
      expect(stored.every((entry) => entry.media.length > 0)).toBe(true);
      const csvResult = await importer.resultCsv(planned.manifestId);
      expect(csvResult).not.toContain('photo_required');
      expect(csvResult).not.toContain('"failed","budget_exceeded"');
      expect(csvResult).not.toContain('limit_reached');
    });

    it('resumes after an interruption at the next batch: rows that hold media are skipped and nothing is loaded twice', async () => {
      const importer = app();
      const planned = await importer.planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');

      const controller = new AbortController();
      let written = 0;
      const attachSpy = vi.spyOn(importer, 'attachImages').mockImplementation(async (manifestId, outcomes) => {
        await CommerceInventoryImportApplication.prototype.attachImages.call(importer, manifestId, outcomes);
        written += 1;
        if (written === 100) controller.abort();
      });
      const first = await photoPhase(importer, planned.manifestId, controller.signal);
      attachSpy.mockRestore();
      expect(first.status).toBe('cancelled');
      const firstBatch = fetched.length;
      expect(firstBatch).toBeLessThanOrEqual(IMPORT_IMAGE_MAX_COUNT);
      expect(firstBatch).toBeGreaterThan(150);
      const held = (await importer.imageTargets(planned.manifestId)).length;
      expect(held).toBeGreaterThan(0);
      expect(held).toBeLessThan(279);

      const afterReload = app();
      const second = await photoPhase(afterReload, planned.manifestId);
      expect(second.status).toBe('complete');
      // Photos shared by listings on both sides of the interruption are reused, not loaded again.
      expect(second.done).toBe(second.total);
      expect(fetched).toHaveLength(725);
      expect(new Set(fetched).size).toBe(725);

      const published = await afterReload.resume(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 279, failed: 0 });
      expect(stored.every((entry) => entry.media.length > 0)).toBe(true);
    });

    it('imports the same store again without loading a photo or running a batch', async () => {
      const importer = app();
      const planned = await importer.planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      await photoPhase(importer, planned.manifestId);
      await importer.publish(planned.manifestId);

      fetched = [];
      const again = app();
      const replanned = await again.planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (replanned.status !== 'planned') throw new Error('plan');
      expect(replanned.photos).toBeUndefined();
      const run = await photoPhase(again, replanned.manifestId);
      expect(run).toMatchObject({ status: 'complete', total: 0 });
      expect(fetched).toEqual([]);
      const published = await again.publish(replanned.manifestId);
      expect(published).toMatchObject({ status: 'complete', failed: 0 });
    });
  });

  describe('known media', () => {
    it('finds a photo already on the rows of the import by its source URL, and nothing for a URL it has not seen', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(2, 2), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await photoPhase(importer, planned.manifestId);
      const urls = [
        'https://shop.example.com/p/0/0.jpg',
        'https://shop.example.com/p/1/1.jpg',
        'https://shop.example.com/p/9/9.jpg',
      ];
      const known = await importer.knownMedia(planned.manifestId, urls);
      expect([...known.keys()]).toEqual(urls.slice(0, 2));
      expect((known.get(urls[0]!) as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY]).toBe(sourceUrlHash(urls[0]!));
      expect(await importer.knownMedia(planned.manifestId, [])).toEqual(new Map());
      expect(await importer.knownMedia('missing', urls)).toEqual(new Map());
    });
  });

  describe('what a store import guarantees, kept across batches', () => {
    it('keeps a photo the seller added by hand, and loads only the new photo on a re-import', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(120, 5), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned.photos).toEqual({ count: 600, batches: 2, pauses: 1 });
      await photoPhase(importer, planned.manifestId);
      await importer.publish(planned.manifestId);
      expect(fetched).toHaveLength(600);

      const listing = stored.find((entry) => entry.listingId === 'sku-119')!;
      const hand = { ...listing.media[0]!, id: 'hand_01', url: CommerceRecordNormalizer.mediaUri(PUBKY, 'hand_01') };
      delete (hand as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
      stored = stored.map((entry) =>
        entry.listingId === 'sku-119' ? { ...entry, media: [...entry.media, hand] } : entry,
      );

      fetched = [];
      const text = new TextDecoder().decode(await wooCsv(120, 5).arrayBuffer());
      const changed = text.replace(
        'https://shop.example.com/p/119/4.jpg"',
        'https://shop.example.com/p/119/4.jpg, https://shop.example.com/p/119/new.jpg"',
      );
      const second = app();
      const replanned = await second.planFile(
        new BytesFile(new TextEncoder().encode(changed), 'products.csv', 'text/csv'),
        CHF,
      );
      if (replanned.status !== 'planned') throw new Error('plan');
      expect(replanned.photos).toEqual({ count: 1, batches: 1, pauses: 0 });
      await photoPhase(second, replanned.manifestId);
      expect(fetched).toEqual(['https://shop.example.com/p/119/new.jpg']);
      await second.publish(replanned.manifestId);
      const after = stored.find((entry) => entry.listingId === 'sku-119')!;
      expect(after.media.map((media) => media.id)).toContain('hand_01');
      expect(after.media).toHaveLength(7);
      expect(
        after.media.map((media) => (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY]).filter(Boolean),
      ).toContain(sourceUrlHash('https://shop.example.com/p/119/new.jpg'));
    });

    it('fails a listing as photo required only when its photos genuinely failed, not because a batch ran out of budget', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(4, 2), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      let calls = 0;
      vi.mocked(ImportImageUploadController.fetchAndPrepare).mockImplementation(async (params) => {
        calls += 1;
        if (params.url.includes('/p/0/')) return { ok: false, reason: 'not_image', fetchedBytes: 0 };
        if (calls <= 2) return { ok: false, reason: 'budget_exceeded', fetchedBytes: 0 };
        const id = `m${calls}`;
        return {
          ok: true,
          fetchedBytes: 10,
          bytes: new Uint8Array([1]),
          media: {
            id,
            type: 'image',
            url: CommerceRecordNormalizer.mediaUri(PUBKY, id),
            contentHash: 'b'.repeat(64),
            mimeType: 'image/webp',
            byteSize: 10,
            width: 10,
            height: 10,
            altText: params.altText,
          },
        };
      });
      const run = await photoPhase(importer, planned.manifestId);
      expect(run.status).toBe('complete');
      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 3, failed: 1 });
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain('photo_required');
      expect(csv.match(/photo_required/g)?.length ?? 0).toBeGreaterThan(0);
      expect(csv).toContain('not_image');
      expect(csv).not.toContain('"failed","budget_exceeded"');
    });
  });
});
