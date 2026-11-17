import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
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
    getMarketplaceUrl: () => 'https://marketplace-service.example.test',
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

describe('an unfinished import, after the dialog was closed or the page reloaded', () => {
  let store: MemoryImportStore;
  let stored: CommerceListingRecord[];
  let fetched: string[];
  let rateLimited: boolean;
  let putConflict: boolean;
  let afterFetch: ((count: number) => void) | null;

  beforeEach(() => {
    store = new MemoryImportStore();
    stored = [];
    fetched = [];
    rateLimited = false;
    putConflict = false;
    afterFetch = null;
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(
      async (params): Promise<TImportImagePrepareResult> => {
        if (rateLimited) return { ok: false, reason: 'rate_limited', fetchedBytes: 0, retryAfterSeconds: 99_999 };
        fetched.push(params.url);
        afterFetch?.(fetched.length);
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
        };
      },
    );
    vi.spyOn(CommerceController, 'commitCreateMedia').mockImplementation(
      async (id) => `pubky://${PUBKY}/media/${String(id)}`,
    );
  });

  /** A fresh application over the same stored import: what a reopened dialog or a reloaded page has. */
  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        if (putConflict) {
          throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed.', {
            service: ErrorService.Homeserver,
            operation: 'putVerifiedPublicListing',
          });
        }
        stored = [...stored.filter((entry) => entry.listingId !== record.listingId), record];
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
  }

  const photoPhase = (importer: CommerceInventoryImportApplication, manifestId: string, signal?: AbortSignal) =>
    runImportImageBatches({
      ownerPubky: PUBKY,
      loadTargets: () => importer.imageTargets(manifestId),
      knownMedia: (urls) => importer.knownMedia(manifestId, urls),
      attach: (outcomes) => importer.attachImages(manifestId, outcomes),
      signal,
    });

  /** The seller presses Publish and the dialog closes after `afterPhotos` photos have loaded. */
  async function startAndClose(importer: CommerceInventoryImportApplication, manifestId: string, afterPhotos: number) {
    await importer.markStarted(manifestId);
    const controller = new AbortController();
    const closeAt = fetched.length + afterPhotos;
    afterFetch = (count) => {
      if (count === closeAt) controller.abort();
    };
    const run = await photoPhase(importer, manifestId, controller.signal);
    afterFetch = null;
    expect(run.status).toBe('cancelled');
  }

  describe('closing in the middle of a batch, then opening the import again', () => {
    // Publishing the full 279-listing catalogue checkpoints every row through a whole-manifest
    // compare-and-swap, so its cost grows with rows x manifest size: about 2 s locally, over 5 s on CI.
    it('offers the store import with its listings done and photos left, and resumes it exactly where it stopped', async () => {
      const first = app();
      const planned = await first.planStoreCatalog(realCatalog(), CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      await startAndClose(first, planned.manifestId, 120);
      expect(fetched).toHaveLength(120);

      const reopened = app();
      const found = await reopened.findUnfinished();
      expect(found).toMatchObject({ manifestId: planned.manifestId, listings: { total: 279 } });
      expect(found?.listings.done).toBe(0);
      // 120 photos were loaded; every one of them is on a row (finished listings, and the partly done one), so 605 are left.
      expect(found?.photosLeft).toBe(605);

      const run = await photoPhase(reopened, planned.manifestId);
      expect(run.status).toBe('complete');
      const published = await reopened.resume(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 279, failed: 0 });
      expect(fetched).toHaveLength(725);
      expect(new Set(fetched).size).toBe(725);
      expect(stored.every((entry) => entry.media.length > 0)).toBe(true);
      expect(await app().findUnfinished()).toBeNull();
    }, 60_000);

    it('does the same for a CSV import', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(130, 5), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await startAndClose(first, planned.manifestId, 53);

      const found = await app().findUnfinished();
      expect(found?.listings.total).toBe(130);
      expect(found?.photosLeft).toBe(650 - 53);

      const reopened = app();
      expect((await photoPhase(reopened, planned.manifestId)).status).toBe('complete');
      expect(await reopened.resume(planned.manifestId)).toMatchObject({
        status: 'complete',
        published: 130,
        failed: 0,
      });
      expect(fetched).toHaveLength(650);
      expect(new Set(fetched).size).toBe(650);
      expect(stored).toHaveLength(130);
    });

    it('keeps the listings that finished before the close: their photos are on their rows, and are not loaded again', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(30, 5), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await startAndClose(first, planned.manifestId, 62);
      const remaining = await app().imageTargets(planned.manifestId);
      expect(remaining.length).toBeLessThan(30);
      expect(remaining.length).toBeGreaterThan(0);
      expect(fetched).toHaveLength(62);

      const reopened = app();
      await photoPhase(reopened, planned.manifestId);
      expect(fetched).toHaveLength(150);
      expect(new Set(fetched).size).toBe(150);
    });
  });

  describe('a reload', () => {
    it('finds the same unfinished import, and finding it changes nothing', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(20, 3), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await startAndClose(first, planned.manifestId, 20);

      const before = [...store.payloads.entries()];
      const one = await app().findUnfinished();
      const two = await app().findUnfinished();
      expect(two).toEqual(one);
      expect([...store.payloads.entries()]).toEqual(before);
      expect(store.manifests.size).toBe(1);
    });

    it('finds an import whose photos were all loaded but whose listings were not yet published', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(5, 2), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await first.markStarted(planned.manifestId);
      await photoPhase(first, planned.manifestId);

      expect(await app().findUnfinished()).toMatchObject({ listings: { done: 0, total: 5 }, photosLeft: 0 });
      expect(await app().resume(planned.manifestId)).toMatchObject({ status: 'complete', published: 5 });
      expect(await app().findUnfinished()).toBeNull();
    });

    it('finds an import that stopped halfway through publishing, counting the listings already published', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(6, 1), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await first.markStarted(planned.manifestId);
      await photoPhase(first, planned.manifestId);
      const manifest = (await store.load(planned.manifestId))!;
      store.manifests.set(planned.manifestId, {
        ...manifest,
        rows: manifest.rows.map((row, index) => (index < 4 ? { ...row, checkpoint: 'complete' as const } : row)),
      });

      expect(await app().findUnfinished()).toMatchObject({ listings: { done: 4, total: 6 }, photosLeft: 0 });
    });

    it('finds an import that stopped because the route would not serve more photos, and resumes it once it will', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(4, 2), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await first.markStarted(planned.manifestId);
      rateLimited = true;
      expect((await photoPhase(first, planned.manifestId)).status).toBe('interrupted');
      expect(fetched).toEqual([]);

      expect(await app().findUnfinished()).toMatchObject({ listings: { done: 0, total: 4 }, photosLeft: 8 });
      rateLimited = false;
      const reopened = app();
      expect((await photoPhase(reopened, planned.manifestId)).status).toBe('complete');
      expect(await reopened.resume(planned.manifestId)).toMatchObject({ status: 'complete', published: 4, failed: 0 });
      expect(fetched).toHaveLength(8);
    });

    it('offers an import with a conflict nobody has answered yet, and not one whose conflicts were answered', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(2, 1), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await first.markStarted(planned.manifestId);
      await photoPhase(first, planned.manifestId);
      putConflict = true;
      const published = await first.resume(planned.manifestId);
      expect(published.status).toBe('conflict');

      expect(await app().findUnfinished()).toMatchObject({ manifestId: planned.manifestId });
      if (published.status !== 'conflict') throw new Error('conflict');
      putConflict = false;
      await first.discardConflict(planned.manifestId, published.listingId);
      const rest = await app().resume(planned.manifestId);
      expect(rest.status === 'complete' || rest.status === 'conflict').toBe(true);
    });
  });

  describe('what is not an unfinished import', () => {
    it('is not a plan the seller only looked at, however many photos it has to load', async () => {
      const planned = await app().planFile(wooCsv(10, 3), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      expect(await app().findUnfinished()).toBeNull();
    });

    it('is not an import that finished, whether it published everything or some listings failed for good', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(3, 1), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await importer.markStarted(planned.manifestId);
      await photoPhase(importer, planned.manifestId);
      await importer.resume(planned.manifestId);
      expect(await app().findUnfinished()).toBeNull();

      const failing = app();
      const second = await failing.planFile(wooCsv(3, 1), { ...CHF, unmanagedStock: 1 });
      if (second.status !== 'planned') throw new Error('plan');
      await failing.markStarted(second.manifestId);
      await failing.resume(second.manifestId);
      expect(await app().findUnfinished()).toBeNull();
    });

    it('is not an import that does nothing, such as a re-import where every listing is unchanged', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(3, 1), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await importer.markStarted(planned.manifestId);
      await photoPhase(importer, planned.manifestId);
      await importer.resume(planned.manifestId);

      const again = app();
      const replanned = await again.planFile(wooCsv(3, 1), CHF);
      if (replanned.status !== 'planned') throw new Error('plan');
      await again.markStarted(replanned.manifestId);
      await again.resume(replanned.manifestId);
      expect(await app().findUnfinished()).toBeNull();
    });

    it('is not offered when there is no stored import at all', async () => {
      expect(await app().findUnfinished()).toBeNull();
    });
  });

  describe('with more than one stored import', () => {
    it('offers the newest, and the older one once the newest is discarded', async () => {
      const importer = app();
      const older = await importer.planFile(wooCsv(4, 2), CHF);
      if (older.status !== 'planned') throw new Error('plan');
      await importer.markStarted(older.manifestId);
      const olderManifest = (await store.load(older.manifestId))!;
      store.manifests.set(older.manifestId, { ...olderManifest, createdAt: '2026-10-01T00:00:00.000Z' });

      const newer = await importer.planFile(wooCsv(5, 2), CHF);
      if (newer.status !== 'planned') throw new Error('plan');
      await importer.markStarted(newer.manifestId);

      const one = await app().findUnfinished();
      expect(one).toMatchObject({ manifestId: newer.manifestId, listings: { total: 5 } });
      await app().discard(newer.manifestId);
      expect(await app().findUnfinished()).toMatchObject({ manifestId: older.manifestId, listings: { total: 4 } });
    });
  });

  describe('discarding', () => {
    it('clears the import and its rows, so it is not offered again, and keeps what it already published', async () => {
      const first = app();
      const planned = await first.planFile(wooCsv(6, 2), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      await first.markStarted(planned.manifestId);
      await photoPhase(first, planned.manifestId);
      await first.resume(planned.manifestId);
      const publishedBefore = stored.length;

      const second = app();
      const again = await second.planFile(wooCsv(8, 2), CHF);
      if (again.status !== 'planned') throw new Error('plan');
      await startAndClose(second, again.manifestId, 2);
      expect(await app().findUnfinished()).toMatchObject({ manifestId: again.manifestId });

      await app().discard(again.manifestId);
      expect(await app().findUnfinished()).toBeNull();
      expect(await store.load(again.manifestId)).toBeNull();
      expect([...store.payloads.keys()].some((key) => key.startsWith(`${again.manifestId}:`))).toBe(false);
      expect(stored).toHaveLength(publishedBefore);
    });

    it('is harmless for an import that is already gone', async () => {
      await expect(app().discard('never-existed')).resolves.toEqual({ removedFiles: 0, failedFiles: 0, cleared: true });
    });
  });

  describe('marking an import as started', () => {
    it('is written once, on the first planned row, and leaves the plan itself as it was', async () => {
      const importer = app();
      const planned = await importer.planFile(wooCsv(3, 1), CHF);
      if (planned.status !== 'planned') throw new Error('plan');
      const rowsBefore = JSON.stringify((await store.load(planned.manifestId))!.rows);
      await importer.markStarted(planned.manifestId);
      const first = (await store.load(planned.manifestId))!.rows[0]!;
      const stamp = JSON.parse((await store.getPayloadJson(planned.manifestId, first.rowIdentity)) ?? '{}') as {
        extraFields: Record<string, string>;
      };
      expect(stamp.extraFields.import_started_at).toMatch(/^\d{4}-\d\d-\d\dT/);

      await importer.markStarted(planned.manifestId);
      const again = JSON.parse((await store.getPayloadJson(planned.manifestId, first.rowIdentity)) ?? '{}') as {
        extraFields: Record<string, string>;
      };
      expect(again.extraFields.import_started_at).toBe(stamp.extraFields.import_started_at);
      expect(JSON.stringify((await store.load(planned.manifestId))!.rows)).toBe(rowsBefore);
      await importer.markStarted('missing');
    });
  });
});
