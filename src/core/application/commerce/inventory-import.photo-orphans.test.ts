import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import { uploadImportImages } from '@/hooks/useImportImageUpload/useImportImageUpload';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { PHOTO_JOURNAL_FIELD } from '@/pipes/commerce/import-image-phase';
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

/** The process dies here: nothing after this point runs. */
class PageLost extends Error {}

type Point = 'before-record' | 'after-record' | 'after-write';

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

describe('a page lost in the middle of a listing leaves no photo file nothing refers to', () => {
  let store: MemoryImportStore;
  let stored: CommerceListingRecord[];
  /** The media files on the seller's homeserver. */
  let files: Set<string>;
  let fetched: string[];
  let nextId: number;

  beforeEach(() => {
    store = new MemoryImportStore();
    stored = [];
    files = new Set();
    fetched = [];
    nextId = 0;
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(
      async (params): Promise<TImportImagePrepareResult> => {
        fetched.push(params.url);
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

  /** A fresh application over the same stored import and the same homeserver: what a reloaded page has. */
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
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
  }

  /** The real upload, with the process dying at the `at`th photo's `point`. */
  const dyingUpload =
    (at: number, point: Point): typeof uploadImportImages =>
    async (params) => {
      let prepared = 0;
      let finished = 0;
      return uploadImportImages({
        ...params,
        onPrepared: async (url, media) => {
          prepared += 1;
          if (point === 'before-record' && prepared === at) throw new PageLost();
          await params.onPrepared?.(url, media);
          if (point === 'after-record' && prepared === at) throw new PageLost();
        },
        onResult: (result) => {
          finished += 1;
          if (point === 'after-write' && finished === at) throw new PageLost();
          params.onResult?.(result);
        },
      });
    };

  const photoPhase = (
    importer: CommerceInventoryImportApplication,
    manifestId: string,
    options: { upload?: typeof uploadImportImages; journal?: boolean } = {},
  ) =>
    runImportImageBatches({
      ownerPubky: PUBKY,
      loadTargets: () => importer.imageTargets(manifestId),
      knownMedia: (urls) => importer.knownMedia(manifestId, urls),
      journal:
        options.journal === false
          ? undefined
          : (rowIdentity, url, media) => importer.journalPhoto(manifestId, rowIdentity, url, media),
      attach: (outcomes) => importer.attachImages(manifestId, outcomes),
      upload: options.upload,
    });

  const referenced = () => new Set(stored.flatMap((listing) => listing.media.map((media) => media.url)));
  const orphans = () => [...files].filter((url) => !referenced().has(url));

  async function startImport(products = 10, photos = 3) {
    const importer = app();
    const planned = await importer.planFile(wooCsv(products, photos), CHF);
    if (planned.status !== 'planned') throw new Error('plan');
    await importer.markStarted(planned.manifestId);
    return planned.manifestId;
  }

  /** The page is lost, the seller opens the import again, resumes, and it finishes. */
  async function loseThenResume(manifestId: string, at: number, point: Point) {
    await expect(photoPhase(app(), manifestId, { upload: dyingUpload(at, point) })).rejects.toBeInstanceOf(PageLost);
    const resumed = app();
    expect(await resumed.findUnfinished()).toMatchObject({ manifestId });
    expect((await photoPhase(resumed, manifestId)).status).toBe('complete');
    expect(await resumed.resume(manifestId)).toMatchObject({ status: 'complete', failed: 0 });
  }

  describe('a reload in the middle of a listing, after some of its photos were uploaded', () => {
    it('leaves no orphan file, loads each photo once, and attaches each photo once', async () => {
      const manifestId = await startImport(10, 3);
      await loseThenResume(manifestId, 7, 'after-write');

      expect(fetched).toHaveLength(30);
      expect(new Set(fetched).size).toBe(30);
      expect(files.size).toBe(30);
      expect(orphans()).toEqual([]);
      expect(stored).toHaveLength(10);
      for (const listing of stored) expect(new Set(listing.media.map((media) => media.url)).size).toBe(3);
      expect(referenced().size).toBe(30);
    });

    it('does the same for a store import of real products', async () => {
      const importer = app();
      const products = REAL_PRODUCTS.filter((entry) => entry.type === 'simple').slice(0, 25);
      const catalog: WooStoreCatalog = {
        storeUrl: 'https://dezentralshop.ch',
        products,
        variations: {},
        unreadProducts: 0,
        total: products.length,
      };
      const planned = await importer.planStoreCatalog(catalog, CHF, OFFERED);
      if (planned.status !== 'planned') throw new Error('plan');
      await importer.markStarted(planned.manifestId);
      const photos = new Set(products.flatMap((entry) => entry.images.map((image) => image.src.trim()))).size;

      await loseThenResume(planned.manifestId, 11, 'after-write');

      expect(fetched).toHaveLength(photos);
      expect(files.size).toBe(photos);
      expect(orphans()).toEqual([]);
      expect(stored).toHaveLength(products.length);
    });

    it('survives being lost again and again: every page loss costs no file, however many there are', async () => {
      const manifestId = await startImport(8, 3);
      await expect(photoPhase(app(), manifestId, { upload: dyingUpload(4, 'after-write') })).rejects.toBeInstanceOf(
        PageLost,
      );
      await expect(photoPhase(app(), manifestId, { upload: dyingUpload(5, 'after-write') })).rejects.toBeInstanceOf(
        PageLost,
      );
      await expect(photoPhase(app(), manifestId, { upload: dyingUpload(2, 'after-write') })).rejects.toBeInstanceOf(
        PageLost,
      );
      const resumed = app();
      expect((await photoPhase(resumed, manifestId)).status).toBe('complete');
      await resumed.resume(manifestId);

      expect(fetched).toHaveLength(24);
      expect(files.size).toBe(24);
      expect(orphans()).toEqual([]);
      expect(referenced().size).toBe(24);
    });
  });

  describe('a reload between the file being written and the upload being recorded as done', () => {
    it('finds the recorded upload and its file at the planned path and attaches it: no orphan and no second upload', async () => {
      const manifestId = await startImport(6, 2);
      // Photo 3 is the first photo of the second listing: its file is written, and the page dies before the run notes it.
      await loseThenResume(manifestId, 3, 'after-write');
      expect(fetched).toHaveLength(12);
      expect(files.size).toBe(12);
      expect(orphans()).toEqual([]);
    });

    it('holds when the file written last completed a listing that had not yet been attached', async () => {
      const manifestId = await startImport(6, 2);
      await loseThenResume(manifestId, 4, 'after-write');
      expect(fetched).toHaveLength(12);
      expect(orphans()).toEqual([]);
      expect(stored).toHaveLength(6);
    });

    it('is closed by recording before writing: the same loss with no record leaves the files of the listing under way as orphans', async () => {
      const manifestId = await startImport(4, 3);
      await expect(
        photoPhase(app(), manifestId, { upload: dyingUpload(5, 'after-write'), journal: false }),
      ).rejects.toBeInstanceOf(PageLost);
      const resumed = app();
      await photoPhase(resumed, manifestId, { journal: false });
      await resumed.resume(manifestId);
      // Photos 4 and 5 are the two uploaded for the second listing; nothing refers to them, and they are loaded again.
      expect(orphans()).toHaveLength(2);
      expect(fetched).toHaveLength(14);
    });
  });

  describe('a reload before the file was written', () => {
    it('after the upload was recorded: the recorded path never got a file, so there is none to leave behind; the photo is loaded again once', async () => {
      const manifestId = await startImport(5, 2);
      await loseThenResume(manifestId, 5, 'after-record');
      expect(orphans()).toEqual([]);
      expect(files.size).toBe(10);
      expect(fetched).toHaveLength(11);
      expect(referenced().size).toBe(10);
    });

    it('before the upload was recorded: nothing was written, so nothing is left behind', async () => {
      const manifestId = await startImport(5, 2);
      await loseThenResume(manifestId, 5, 'before-record');
      expect(orphans()).toEqual([]);
      expect(files.size).toBe(10);
      expect(fetched).toHaveLength(11);
    });
  });

  describe('a normal import', () => {
    it('uploads every photo exactly once and writes every file once, and the rows keep a record of each file written', async () => {
      const manifestId = await startImport(10, 3);
      const importer = app();
      expect((await photoPhase(importer, manifestId)).status).toBe('complete');
      await importer.resume(manifestId);

      expect(fetched).toHaveLength(30);
      expect(new Set(fetched).size).toBe(30);
      expect(files.size).toBe(30);
      expect(orphans()).toEqual([]);
      const recorded = new Set<string>();
      for (const value of store.payloads.values()) {
        const payload = JSON.parse(value) as { extraFields?: Record<string, string> };
        const entries = JSON.parse(payload.extraFields?.[PHOTO_JOURNAL_FIELD] ?? '[]') as { media: { url: string } }[];
        for (const entry of entries) recorded.add(entry.media.url);
      }
      expect(recorded).toEqual(files);
    });

    it('records each photo on the first row of its listing before its file is written', async () => {
      const manifestId = await startImport(2, 2);
      const importer = app();
      const order: string[] = [];
      const record = vi.spyOn(importer, 'journalPhoto').mockImplementation(async (id, row, url, media) => {
        order.push(`record ${url.split('.example.com/p/')[1]}`);
        await CommerceInventoryImportApplication.prototype.journalPhoto.call(importer, id, row, url, media);
      });
      vi.mocked(CommerceController.commitCreateMedia).mockImplementation(async (id) => {
        order.push(`write ${String(id)}`);
        files.add(CommerceRecordNormalizer.mediaUri(PUBKY, String(id)));
        return 'ok';
      });
      await photoPhase(importer, manifestId);
      record.mockRestore();
      expect(order).toEqual([
        'record 0/0.jpg',
        'write media00001',
        'record 0/1.jpg',
        'write media00002',
        'record 1/0.jpg',
        'write media00003',
        'record 1/1.jpg',
        'write media00004',
      ]);
    });

    it('does not load a photo again when the import is run again after it finished', async () => {
      const manifestId = await startImport(4, 2);
      const importer = app();
      await photoPhase(importer, manifestId);
      await importer.resume(manifestId);
      fetched = [];
      expect((await photoPhase(app(), manifestId)).total).toBe(0);
      expect(fetched).toEqual([]);
      expect(files.size).toBe(8);
    });
  });

  describe('the record of an upload', () => {
    const media = (id: string) => ({ id, type: 'image', url: CommerceRecordNormalizer.mediaUri(PUBKY, id) });

    async function planned(photos = 2) {
      const importer = app();
      const result = await importer.planFile(wooCsv(2, photos), CHF);
      if (result.status !== 'planned') throw new Error('plan');
      const manifest = (await store.load(result.manifestId))!;
      return { importer, manifestId: result.manifestId, rows: manifest.rows };
    }
    const payloadOf = async (manifestId: string, row: string) =>
      JSON.parse((await store.getPayloadJson(manifestId, row)) ?? '{}') as { extraFields: Record<string, string> };

    it('is kept on the row it is given, next to what the row already holds, and replaced for the same photo', async () => {
      const { importer, manifestId, rows } = await planned();
      const first = rows[0]!.rowIdentity;
      const before = await payloadOf(manifestId, first);
      await importer.journalPhoto(manifestId, first, 'https://shop.example.com/p/0/0.jpg', media('m1'));
      await importer.journalPhoto(manifestId, first, 'https://shop.example.com/p/0/1.jpg', media('m2'));
      await importer.journalPhoto(manifestId, first, 'https://shop.example.com/p/0/0.jpg', media('m3'));

      const after = await payloadOf(manifestId, first);
      const entries = JSON.parse(after.extraFields[PHOTO_JOURNAL_FIELD] ?? '[]') as { media: { id: string } }[];
      expect(entries.map((entry) => entry.media.id)).toEqual(['m2', 'm3']);
      expect({ ...after.extraFields, [PHOTO_JOURNAL_FIELD]: undefined }).toEqual({
        ...before.extraFields,
        [PHOTO_JOURNAL_FIELD]: undefined,
      });
      expect((await payloadOf(manifestId, rows[1]!.rowIdentity)).extraFields[PHOTO_JOURNAL_FIELD]).toBeUndefined();
    });

    it('is ignored for a row that is not there, and changes nothing', async () => {
      const { importer, manifestId } = await planned();
      const payloads = JSON.stringify([...store.payloads.entries()]);
      await importer.journalPhoto(manifestId, 'no-such-row', 'https://shop.example.com/p/0/0.jpg', media('m1'));
      expect(JSON.stringify([...store.payloads.entries()])).toBe(payloads);
    });

    it('is reused only when its file is on the homeserver, and only for a photo that is asked for', async () => {
      const { importer, manifestId, rows } = await planned();
      const first = rows[0]!.rowIdentity;
      const present = 'https://shop.example.com/p/0/0.jpg';
      const missing = 'https://shop.example.com/p/0/1.jpg';
      const unasked = 'https://shop.example.com/p/1/0.jpg';
      await importer.journalPhoto(manifestId, first, present, media('on-server'));
      await importer.journalPhoto(manifestId, first, missing, media('never-written'));
      await importer.journalPhoto(manifestId, first, unasked, media('unasked'));
      files.add(CommerceRecordNormalizer.mediaUri(PUBKY, 'on-server'));
      files.add(CommerceRecordNormalizer.mediaUri(PUBKY, 'unasked'));
      const asked: string[] = [];
      const spying = CommerceInventoryImportApplication.forSeller(PUBKY, {
        store,
        mediaExists: async (url) => {
          asked.push(url);
          return files.has(url);
        },
      });

      const known = await spying.knownMedia(manifestId, [present, missing]);
      expect([...known.keys()]).toEqual([present]);
      expect((known.get(present) as { id: string }).id).toBe('on-server');
      expect(asked.sort()).toEqual(
        [
          CommerceRecordNormalizer.mediaUri(PUBKY, 'never-written'),
          CommerceRecordNormalizer.mediaUri(PUBKY, 'on-server'),
        ].sort(),
      );
    });

    it('is not asked about for a photo already attached to a listing, which needs no check', async () => {
      const { importer, manifestId } = await planned(1);
      await photoPhase(importer, manifestId);
      const asked = vi.fn(async () => true);
      const checking = CommerceInventoryImportApplication.forSeller(PUBKY, { store, mediaExists: asked });
      const known = await checking.knownMedia(manifestId, ['https://shop.example.com/p/0/0.jpg']);
      expect(known.size).toBe(1);
      expect(asked).not.toHaveBeenCalled();
    });
  });
});
