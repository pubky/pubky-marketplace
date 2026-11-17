import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { db } from '@/database/franky/franky';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import type { ImportSettings } from '@/pipes/commerce/import-settings';
import {
  DexieManifestStore,
  type HostPlannedImportRow,
  type HostRowPatchResult,
  type InventoryManifestStore,
} from '@/services/marketplace/marketplace-import-store';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const CHF: ImportSettings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' };
/** planned → publishing → published_unsynced → complete */
const HOPS_PER_ROW = 3;

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

function wooCsv(products: number): BytesFile {
  const rows = Array.from(
    { length: products },
    (_, index) =>
      `${index + 1},simple,sku-${index},"Product ${index}",1,Described,1,5,10,Things,https://shop.example.com/p/${index}.jpg`,
  );
  const text = ['ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price,Categories,Images', ...rows].join(
    '\n',
  );
  return new BytesFile(new TextEncoder().encode(text), 'products.csv', 'text/csv');
}

beforeEach(() => {
  vi.restoreAllMocks();
  let uploaded = 0;
  vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(
    async (params): Promise<TImportImagePrepareResult> => {
      uploaded += 1;
      const id = `m${uploaded}`;
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

const syncAll = (listings: readonly { listing_id: string }[]) => ({
  ok: true as const,
  value: asOpaque<SyncManyEnvelope>({
    schema_version: BigInt(1),
    kind: 'listing.sync_many',
    results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
  }),
});

type Seller = {
  stored: CommerceListingRecord[];
  puts: Map<string, number>;
  hangPut: ((listingId: string, count: number) => boolean) | null;
};

function sellerState(): Seller {
  return { stored: [], puts: new Map(), hangPut: null };
}

function app(store: InventoryManifestStore, seller: Seller) {
  return CommerceInventoryImportApplication.forSeller(PUBKY, {
    store,
    currentItems: async () => ({}),
    localRecords: async () => seller.stored,
    putListing: async (record) => {
      const count = (seller.puts.get(record.listingId) ?? 0) + 1;
      seller.puts.set(record.listingId, count);
      if (seller.hangPut?.(record.listingId, count)) await new Promise<never>(() => {});
      seller.stored = [...seller.stored.filter((entry) => entry.listingId !== record.listingId), record];
    },
    listingExists: async () => false,
    syncMany: async (listings) => syncAll(listings),
    loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
    loadDeliveryKeyPublication: async () => 'matches',
    loadShop: async () => null,
  });
}

/** Plans the listings and loads their photos, so every listing is ready to publish. */
async function plan(importer: CommerceInventoryImportApplication, listings: number): Promise<string> {
  const planned = await importer.planFile(wooCsv(listings), CHF);
  if (planned.status !== 'planned') throw new Error(`plan: ${planned.status}`);
  const photos = await runImportImageBatches({
    ownerPubky: PUBKY,
    loadTargets: () => importer.imageTargets(planned.manifestId),
    knownMedia: (urls) => importer.knownMedia(planned.manifestId, urls),
    attach: (outcomes) => importer.attachImages(planned.manifestId, outcomes),
  });
  if (photos.status !== 'complete') throw new Error(`photos: ${photos.status}`);
  return planned.manifestId;
}

async function publishCost(listings: number) {
  const store = new MemoryImportStore();
  const importer = app(store, sellerState());
  const manifestId = await plan(importer, listings);
  store.rowReads = 0;
  store.rowWrites = 0;
  const result = await importer.publish(manifestId);
  expect(result).toMatchObject({ status: 'complete', published: listings, failed: 0 });
  return { reads: store.rowReads, writes: store.rowWrites };
}

describe('import row checkpoints', () => {
  describe('cost', () => {
    it('writes each row once per checkpoint hop when publishing, so N listings cost O(N) row writes', async () => {
      const small = await publishCost(50);
      const large = await publishCost(500);
      expect(small.writes).toBe(50 * HOPS_PER_ROW);
      expect(large.writes).toBe(500 * HOPS_PER_ROW);
    });

    it('reads the same number of rows per listing for 50 listings as for 500', async () => {
      const small = await publishCost(50);
      const large = await publishCost(500);
      expect(large.reads / 500).toBe(small.reads / 50);
    });
  });

  describe('a second tab writing at the same time (in-memory store)', () => {
    /** Another tab lands a write on a different row right before this tab's next checkpoint write. */
    class RacedStore extends MemoryImportStore {
      raced = 0;
      race: ((manifestId: string, rowIdentity: string) => Promise<void>) | null = null;

      override async patchRow(
        manifestId: string,
        expectedVersion: number,
        rowIdentity: string,
        update: (row: HostPlannedImportRow) => HostPlannedImportRow,
      ): Promise<HostRowPatchResult> {
        const race = this.race;
        if (race) {
          this.race = null;
          this.raced += 1;
          await race(manifestId, rowIdentity);
        }
        return super.patchRow(manifestId, expectedVersion, rowIdentity, update);
      }
    }

    it('retries a checkpoint that lost to a write on another row, and keeps both', async () => {
      const store = new RacedStore();
      const importer = app(store, sellerState());
      const manifestId = await plan(importer, 3);
      const rows = (await store.load(manifestId))!.rows;
      const other = rows[2]!.rowIdentity;
      store.race = async (id, rowIdentity) => {
        expect(rowIdentity).not.toBe(other);
        const current = await store.loadRows(id, [other]);
        await MemoryImportStore.prototype.patchRow.call(store, id, current!.manifestVersion, other, (row) => ({
          ...row,
          failureCode: 'written by another tab',
        }));
      };
      const result = await importer.publish(manifestId);
      expect(store.raced).toBe(1);
      expect(result).toMatchObject({ status: 'complete', published: 3 });
      const final = (await store.load(manifestId))!;
      expect(final.rows.every((row) => row.checkpoint === 'complete')).toBe(true);
      expect(final.rows[2]?.failureCode).toBe('written by another tab');
      expect(final.manifestVersion).toBe(1 + 3 * HOPS_PER_ROW + 1);
    });
  });

  describe('with the Dexie store', () => {
    beforeEach(async () => {
      await db.open();
    });

    afterEach(async () => {
      await db.close();
    });

    it('two tabs publishing the same import at once land every checkpoint exactly once', async () => {
      const listings = 12;
      const seller = sellerState();
      const tabA = app(new DexieManifestStore(PUBKY), seller);
      const tabB = app(new DexieManifestStore(PUBKY), seller);
      const manifestId = await plan(tabA, listings);

      await Promise.all([tabA.publish(manifestId), tabB.publish(manifestId)]);

      const final = (await new DexieManifestStore(PUBKY).load(manifestId))!;
      expect(final.rows).toHaveLength(listings);
      expect(final.rows.every((row) => row.checkpoint === 'complete')).toBe(true);
      // Every hop of every row was written once: none lost to the other tab, none written twice.
      expect(final.manifestVersion).toBe(1 + listings * HOPS_PER_ROW);
      expect(seller.stored).toHaveLength(listings);
      await new DexieManifestStore(PUBKY).deleteManifest(manifestId);
    });

    it('a reload mid-publish resumes where it stopped, without publishing a finished listing again', async () => {
      const listings = 10;
      const seller = sellerState();
      const first = app(new DexieManifestStore(PUBKY), seller);
      const manifestId = await plan(first, listings);
      const order = (await new DexieManifestStore(PUBKY).load(manifestId))!.rows.map((row) => row.listingId);
      const stopAt = order[6]!;
      let reachedStop: () => void = () => {};
      const stopped = new Promise<void>((resolve) => {
        reachedStop = resolve;
      });
      seller.hangPut = (listingId, count) => {
        if (listingId !== stopAt || count !== 1) return false;
        reachedStop();
        return true;
      };

      // The page goes away while the seventh listing's PUT is in flight: that publish never returns.
      void first.publish(manifestId);
      await stopped;
      db.close();
      await db.open();

      seller.hangPut = null;
      const reloaded = app(new DexieManifestStore(PUBKY), seller);
      const resumed = await reloaded.resume(manifestId);
      expect(resumed).toMatchObject({ status: 'complete', failed: 0 });

      const final = (await new DexieManifestStore(PUBKY).load(manifestId))!;
      expect(final.rows.every((row) => row.checkpoint === 'complete')).toBe(true);
      for (const listingId of order) {
        expect(seller.puts.get(listingId)).toBe(listingId === stopAt ? 2 : 1);
      }
      expect(final.manifestVersion).toBe(1 + listings * HOPS_PER_ROW);
      await new DexieManifestStore(PUBKY).deleteManifest(manifestId);
    });

    it('checkpoints through the store without one whole-manifest rewrite', async () => {
      const store = new DexieManifestStore(PUBKY);
      const importer = app(store, sellerState());
      const manifestId = await plan(importer, 5);
      const swap = vi.spyOn(store, 'compareAndSwap');
      const patch = vi.spyOn(store, 'patchRow');
      await importer.publish(manifestId);
      expect(swap).not.toHaveBeenCalled();
      expect(patch).toHaveBeenCalledTimes(5 * HOPS_PER_ROW);
      await store.deleteManifest(manifestId);
    });
  });

  it('keeps the service checkpoint result in the SDK shape', async () => {
    const store = new MemoryImportStore();
    const manifestId = await plan(app(store, sellerState()), 1);
    const row = (await store.load(manifestId))!.rows[0]!;
    const result = await MarketplaceShopClientService.checkpointRow(
      store,
      manifestId,
      1,
      row.rowIdentity,
      'publishing',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest).toMatchObject({ manifestId, manifestVersion: 2 });
    expect(result.value.row).toMatchObject({ rowIdentity: row.rowIdentity, checkpoint: 'publishing' });
    const stale = await MarketplaceShopClientService.checkpointRow(store, manifestId, 1, row.rowIdentity, 'publishing');
    expect(stale.ok).toBe(false);
  });
});
