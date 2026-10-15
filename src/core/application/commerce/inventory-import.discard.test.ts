import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { PHOTO_JOURNAL_FIELD } from '@/pipes/commerce/import-image-phase';
import type { ImportSettings } from '@/pipes/commerce/import-settings';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const CHF: ImportSettings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' };

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

const syncAll = (listings: readonly { listing_id: string }[]) => ({
  ok: true as const,
  value: asOpaque<SyncManyEnvelope>({
    schema_version: BigInt(1),
    kind: 'listing.sync_many',
    results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
  }),
});

/** One simple product per entry, each with its own photo URLs. */
function wooCsv(products: readonly { sku: string; photos: readonly string[] }[]): BytesFile {
  const rows = products.map(
    (product, index) =>
      `${index + 1},simple,${product.sku},"Product ${product.sku}",1,Described,1,5,10,Things,"${product.photos.join(', ')}"`,
  );
  const text = ['ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price,Categories,Images', ...rows].join(
    '\n',
  );
  return new BytesFile(new TextEncoder().encode(text), 'products.csv', 'text/csv');
}

const photos = (sku: string, count: number) =>
  Array.from({ length: count }, (_, index) => `https://shop.example.com/${sku}/${index}.jpg`);
const products = (count: number, perProduct = 2, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({
    sku: `sku-${index + offset}`,
    photos: photos(`sku-${index + offset}`, perProduct),
  }));

describe('discarding an unfinished import deletes the photo files nothing published refers to', () => {
  let store: MemoryImportStore;
  let stored: CommerceListingRecord[];
  let files: Set<string>;
  let deleted: string[];
  let undeletable: Set<string>;
  let nextId: number;

  beforeEach(() => {
    store = new MemoryImportStore();
    stored = [];
    files = new Set();
    deleted = [];
    undeletable = new Set();
    nextId = 0;
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(
      async (params): Promise<TImportImagePrepareResult> => {
        nextId += 1;
        const id = `media${String(nextId).padStart(5, '0')}`;
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
    vi.spyOn(CommerceController, 'commitCreateMedia').mockImplementation(async (id) => {
      const url = CommerceRecordNormalizer.mediaUri(PUBKY, String(id));
      files.add(url);
      return url;
    });
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        stored = [...stored.filter((entry) => entry.listingId !== record.listingId), record];
      },
      listingExists: async () => false,
      mediaExists: async (url) => files.has(url),
      deleteMedia: async (url) => {
        if (undeletable.has(url)) throw new Error('homeserver refused');
        files.delete(url);
        deleted.push(url);
      },
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
  }

  const photoPhase = (importer: CommerceInventoryImportApplication, manifestId: string) =>
    runImportImageBatches({
      ownerPubky: PUBKY,
      loadTargets: () => importer.imageTargets(manifestId),
      knownMedia: (urls) => importer.knownMedia(manifestId, urls),
      journal: (rowIdentity, url, media) => importer.journalPhoto(manifestId, rowIdentity, url, media),
      attach: (outcomes) => importer.attachImages(manifestId, outcomes),
    });

  async function plan(file: BytesFile) {
    const importer = app();
    const planned = await importer.planFile(file, CHF);
    if (planned.status !== 'planned') throw new Error('plan');
    await importer.markStarted(planned.manifestId);
    return { importer, manifestId: planned.manifestId };
  }

  const mediaUrlsOf = (listingId: string) =>
    stored.find((entry) => entry.listingId === listingId)?.media.map((m) => m.url);
  const referenced = () => new Set(stored.flatMap((listing) => listing.media.map((media) => media.url)));
  const orphans = () => [...files].filter((url) => !referenced().has(url));

  /** Puts a listing back as not yet published, as if the import had stopped before it. */
  async function unpublish(manifestId: string, listingIds: string[]) {
    const manifest = (await store.load(manifestId))!;
    store.manifests.set(manifestId, {
      ...manifest,
      rows: manifest.rows.map((row) =>
        listingIds.includes(row.listingId) ? { ...row, checkpoint: 'planned' as const } : row,
      ),
    });
    stored = stored.filter((entry) => !listingIds.includes(entry.listingId));
  }

  it('deletes every photo file of an import that stopped before anything was published, and clears the import', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(5, 3)));
    await photoPhase(importer, manifestId);
    expect(files.size).toBe(15);

    const result = await app().discard(manifestId);

    expect(result).toEqual({ removedFiles: 15, failedFiles: 0, cleared: true });
    expect(files.size).toBe(0);
    expect(deleted).toHaveLength(15);
    expect(await store.load(manifestId)).toBeNull();
    expect(await app().findUnfinished()).toBeNull();
    expect(stored).toEqual([]);
  });

  it('keeps the photos of the listings the import already published, and deletes the rest', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(6, 2)));
    await photoPhase(importer, manifestId);
    await importer.resume(manifestId);
    const publishedUrls = mediaUrlsOf('sku-0')!;
    await unpublish(manifestId, ['sku-3', 'sku-4', 'sku-5']);

    const result = await app().discard(manifestId);

    expect(result).toMatchObject({ removedFiles: 6, failedFiles: 0, cleared: true });
    expect(stored.map((entry) => entry.listingId).sort()).toEqual(['sku-0', 'sku-1', 'sku-2']);
    expect(files.size).toBe(6);
    expect(orphans()).toEqual([]);
    for (const url of publishedUrls) expect(files.has(url)).toBe(true);
  });

  it("does not rely on the local copy of the seller's listings: a listing the import published is kept even if that copy lacks it", async () => {
    const { importer, manifestId } = await plan(wooCsv(products(3, 2)));
    await photoPhase(importer, manifestId);
    await importer.resume(manifestId);
    stored = [];

    const result = await app().discard(manifestId);

    expect(result).toEqual({ removedFiles: 0, failedFiles: 0, cleared: true });
    expect(files.size).toBe(6);
  });

  it('treats a listing whose publish was under way as published, since its record may have been written', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(2, 2)));
    await photoPhase(importer, manifestId);
    const manifest = (await store.load(manifestId))!;
    store.manifests.set(manifestId, {
      ...manifest,
      rows: manifest.rows.map((row) =>
        row.listingId === 'sku-0' ? { ...row, checkpoint: 'publishing' as const } : row,
      ),
    });

    const result = await app().discard(manifestId);

    expect(result).toMatchObject({ removedFiles: 2, cleared: true });
    expect(files.size).toBe(2);
  });

  it('never deletes a photo that a published listing also uses', async () => {
    const shared = 'https://shop.example.com/shared.jpg';
    const { importer, manifestId } = await plan(
      wooCsv([
        { sku: 'sku-0', photos: [shared, ...photos('sku-0', 1)] },
        { sku: 'sku-1', photos: [shared, ...photos('sku-1', 1)] },
      ]),
    );
    await photoPhase(importer, manifestId);
    await importer.resume(manifestId);
    await unpublish(manifestId, ['sku-0']);

    await app().discard(manifestId);

    const sharedUrl = mediaUrlsOf('sku-1')![0]!;
    expect(files.has(sharedUrl)).toBe(true);
    expect(files.size).toBe(2);
    expect(orphans()).toEqual([]);
  });

  it('never deletes the photos of a listing the seller already had: only files this import wrote are touched', async () => {
    const first = await plan(wooCsv(products(1, 2)));
    await photoPhase(first.importer, first.manifestId);
    await first.importer.resume(first.manifestId);
    const oldFiles = new Set(files);
    expect(oldFiles.size).toBe(2);

    const second = await plan(
      wooCsv([{ sku: 'sku-0', photos: [...photos('sku-0', 2), 'https://shop.example.com/new.jpg'] }]),
    );
    await photoPhase(second.importer, second.manifestId);
    expect(files.size).toBe(3);

    const result = await app().discard(second.manifestId);

    expect(result).toMatchObject({ removedFiles: 1, cleared: true });
    expect(files).toEqual(oldFiles);
    expect(orphans()).toEqual([]);
  });

  it('never deletes a file a stored listing of the seller refers to, whatever the import says', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(2, 1)));
    await photoPhase(importer, manifestId);
    const [url] = [...files];
    stored = [
      asOpaque<CommerceListingRecord>({
        listingId: 'other',
        ownerPubky: PUBKY,
        media: [{ id: 'x', url, type: 'image' }],
        variants: [],
      }),
    ];
    await app().discard(manifestId);
    expect(files.has(url!)).toBe(true);
    expect(files.size).toBe(1);
  });

  it('skips an upload that was recorded but whose file was never written', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(1, 1)));
    const manifest = (await store.load(manifestId))!;
    await importer.journalPhoto(
      manifestId,
      manifest.rows[0]!.rowIdentity,
      'https://shop.example.com/sku-0/0.jpg',
      asOpaque({ id: 'never-written', url: CommerceRecordNormalizer.mediaUri(PUBKY, 'never-written') }),
    );
    const result = await app().discard(manifestId);
    expect(result).toEqual({ removedFiles: 0, failedFiles: 0, cleared: true });
    expect(deleted).toEqual([]);
  });

  it("deletes only paths in the seller's own media folder, whatever a record says", async () => {
    const { importer, manifestId } = await plan(wooCsv(products(1, 1)));
    const row = (await store.load(manifestId))!.rows[0]!.rowIdentity;
    const strangers = [
      `pubky://${'z'.repeat(52)}/pub/pubky.app/marketplace/v1/media/media99999`,
      `pubky://${PUBKY}/pub/pubky.app/marketplace/v1/listings/sku-0`,
      'https://evil.example.com/media/media99998',
    ];
    for (const [index, url] of strangers.entries()) {
      files.add(url);
      await importer.journalPhoto(
        manifestId,
        row,
        `https://shop.example.com/stranger/${index}.jpg`,
        asOpaque({ id: `media9999${index}`, url }),
      );
    }
    await app().discard(manifestId);
    expect(deleted).toEqual([]);
    for (const url of strangers) expect(files.has(url)).toBe(true);
  });

  it('keeps the import when a file cannot be deleted, says how many, and a second Discard finishes without deleting twice', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(4, 2)));
    await photoPhase(importer, manifestId);
    const stubborn = [...files][3]!;
    undeletable.add(stubborn);

    const first = await app().discard(manifestId);
    expect(first).toEqual({ removedFiles: 7, failedFiles: 1, cleared: false });
    expect(await store.load(manifestId)).not.toBeNull();
    expect(await app().findUnfinished()).toMatchObject({ manifestId });
    expect([...files]).toEqual([stubborn]);

    undeletable.clear();
    const second = await app().discard(manifestId);
    expect(second).toEqual({ removedFiles: 1, failedFiles: 0, cleared: true });
    expect(files.size).toBe(0);
    expect(new Set(deleted).size).toBe(deleted.length);
    expect(await store.load(manifestId)).toBeNull();
  });

  it('still lets the import be resumed after a Discard that could not finish', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(2, 1)));
    await photoPhase(importer, manifestId);
    undeletable.add([...files][0]!);
    expect((await app().discard(manifestId)).cleared).toBe(false);
    undeletable.clear();
    const resumed = app();
    expect(await resumed.findUnfinished()).toMatchObject({ manifestId });
    expect((await photoPhase(resumed, manifestId)).status).toBe('complete');
  });

  it('removes nothing for an import that is not there', async () => {
    expect(await app().discard('never-existed')).toEqual({ removedFiles: 0, failedFiles: 0, cleared: true });
    expect(deleted).toEqual([]);
  });

  it('is what a journal-only record needs: a photo recorded and written but never attached is deleted too', async () => {
    const { importer, manifestId } = await plan(wooCsv(products(1, 2)));
    const row = (await store.load(manifestId))!.rows[0]!.rowIdentity;
    const url = CommerceRecordNormalizer.mediaUri(PUBKY, 'written-not-attached');
    files.add(url);
    await importer.journalPhoto(
      manifestId,
      row,
      'https://shop.example.com/sku-0/0.jpg',
      asOpaque({ id: 'written-not-attached', url }),
    );
    expect(
      JSON.parse(JSON.parse((await store.getPayloadJson(manifestId, row)) ?? '{}').extraFields[PHOTO_JOURNAL_FIELD]),
    ).toHaveLength(1);

    expect(await app().discard(manifestId)).toMatchObject({ removedFiles: 1, cleared: true });
    expect(files.has(url)).toBe(false);
  });
});
