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
import { type PresetJson, SOURCE_IMAGE_URLS_FIELD } from '@/pipes/commerce/import-preset-rows';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');
const CHF = { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' };

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

type Recorded = { responses: { url: string; status: number; contentType: string; contentLength: number }[] };
const RECORDED = new Map(
  (JSON.parse(readFileSync(resolve(FIXTURES, 'dezentralshop-image-headers.json'), 'utf8')) as Recorded).responses.map(
    (response) => [response.url, response],
  ),
);

const BASE = 'https://dezentralshop.ch/wp-content/uploads/2025/12/';
const A = `${BASE}Socken-I-scaled-1.jpg`;
const B = `${BASE}Socken-II-scaled-1.jpg`;
const C = `${BASE}Socken-Box-I-scaled-1.jpg`;
const D = `${BASE}Socken-Box-II-scaled-2.jpg`;

const WITH_METHOD: SellerPaymentConfig = {
  bitcoinAvailable: true,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};
const NO_METHOD: SellerPaymentConfig = { bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: false };

function prepared(params: { url: string; altText: string }): TImportImagePrepareResult {
  const recorded = RECORDED.get(params.url);
  if (!recorded || params.url === FAIL_URL) return { ok: false, reason: 'http_error', fetchedBytes: 0 };
  const id = `m${[...RECORDED.keys()].indexOf(params.url) + 1}`;
  return {
    ok: true,
    fetchedBytes: recorded.contentLength,
    bytes: new Uint8Array([1, 2, 3]),
    media: {
      id,
      type: 'image',
      url: CommerceRecordNormalizer.mediaUri(PUBKY, id),
      contentHash: 'a'.repeat(64),
      mimeType: recorded.contentType,
      byteSize: recorded.contentLength,
      width: 800,
      height: 800,
      altText: params.altText,
    },
  };
}

let FAIL_URL: string | null = null;

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

function csvFor(options: { title?: string; urls: string[]; price?: string }): BytesFile {
  const text = [
    'ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price,Categories,Images',
    `1,simple,sock-1,"${options.title ?? 'Little Hodler Socks'}",1,Warm socks,1,5,${options.price ?? '25'},Apparel,"${options.urls.join(', ')}"`,
  ].join('\n');
  return new BytesFile(new TextEncoder().encode(text), 'socks.csv', 'text/csv');
}

describe('re-importing photos for a listing that already exists', () => {
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
    FAIL_URL = null;
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(async (params) => {
      fetched.push(params.url);
      return prepared(params);
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

  /** The same sequence the import hook runs: plan, photo phase, publish. */
  async function runImport(file: BytesFile, afterPlan?: (manifestId: string) => void) {
    const importer = app();
    const planned = await importer.planFile(file, CHF);
    if (planned.status !== 'planned') throw new Error('plan');
    afterPlan?.(planned.manifestId);
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
    return { importer, planned, targets, published };
  }

  const record = () => stored.find((entry) => entry.listingId === 'sock-1');
  const hashesOf = (listing: CommerceListingRecord | undefined) =>
    listing?.media.map((media) => (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY]);

  async function firstImport(urls = [A, B, C]) {
    const result = await runImport(csvFor({ urls }));
    expect(fetched).toEqual(urls);
    expect(record()?.media).toHaveLength(urls.length);
    return result;
  }

  it('records where each photo came from, as a hash, and never publishes the shop address', async () => {
    await firstImport();
    expect(hashesOf(record())).toEqual([A, B, C].map(sourceUrlHash));
    expect(JSON.stringify(record())).not.toContain('dezentralshop.ch');
    expect(JSON.stringify(record())).not.toContain(A);
  });

  it('uploads nothing when the photo URLs are unchanged, and says so', async () => {
    await firstImport();
    const before = record()?.media;
    const { importer, planned, targets } = await runImport(
      csvFor({ urls: [A, B, C], title: 'Little Hodler Socks, new' }),
    );

    expect(fetched).toEqual([]);
    expect(targets).toMatchObject([{ listingId: 'sock-1', images: [], sync: { removed: 0, handKept: 0 } }]);
    expect(record()?.title).toBe('Little Hodler Socks, new');
    expect(record()?.revision).toBe(2);
    expect(record()?.media).toEqual(before);
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"sock-1","","","","","summary","photos unchanged"');
    expect(csv).toContain('listing_id,row_identity,checkpoint,result,image_url,image_status,image_reason');
  });

  it('uploads only the one URL that is new, after the stored photos', async () => {
    await firstImport();
    const before = record()?.media.map((media) => media.id);
    const { importer, planned } = await runImport(csvFor({ urls: [A, B, C, D], title: 'Socks plus box' }));

    expect(fetched).toEqual([D]);
    expect(
      record()
        ?.media.map((media) => media.id)
        .slice(0, 3),
    ).toEqual(before);
    expect(record()?.media).toHaveLength(4);
    expect(hashesOf(record())).toEqual([A, B, C, D].map(sourceUrlHash));
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"summary","1 added, 0 removed"');
    expect(csv).toContain(`"sock-1","","","","${D}","uploaded",""`);
  });

  it('drops the photo whose URL left the file, keeping the store order, with no upload', async () => {
    await firstImport();
    const before = record()?.media.map((media) => media.id) ?? [];
    const { importer, planned } = await runImport(csvFor({ urls: [A, C], title: 'Socks without B' }));

    expect(fetched).toEqual([]);
    expect(record()?.media.map((media) => media.id)).toEqual([before[0], before[2]]);
    expect(await importer.resultCsv(planned.manifestId)).toContain('"summary","0 added, 1 removed"');
  });

  it('keeps the stored order when the file lists the same photos in another order', async () => {
    await firstImport();
    const before = record()?.media.map((media) => media.id);
    await runImport(csvFor({ urls: [C, B, A], title: 'Socks reordered' }));
    expect(fetched).toEqual([]);
    expect(record()?.media.map((media) => media.id)).toEqual(before);
  });

  it('never touches a photo the seller added by hand, and reports it as kept', async () => {
    await firstImport();
    const hand = {
      id: 'hand_01',
      type: 'image' as const,
      url: CommerceRecordNormalizer.mediaUri(PUBKY, 'hand_01'),
      contentHash: 'b'.repeat(64),
      mimeType: 'image/jpeg',
      byteSize: 1_000,
      width: 400,
      height: 400,
      altText: 'Added in the Shop',
    };
    stored = stored.map((listing) => ({ ...listing, media: [listing.media[0]!, hand, ...listing.media.slice(1)] }));

    const { importer, planned } = await runImport(csvFor({ urls: [A, D], title: 'Socks, B and C gone, D new' }));

    expect(fetched).toEqual([D]);
    const ids = record()?.media.map((media) => media.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(ids[0]).toMatch(/^m/);
    expect(ids[1]).toBe('hand_01');
    expect(record()?.media[1]).toEqual(hand);
    expect(hashesOf(record())).toEqual([sourceUrlHash(A), undefined, sourceUrlHash(D)]);
    expect(await importer.resultCsv(planned.manifestId)).toContain(
      '"summary","1 added, 2 removed, 1 kept (added in the Shop)"',
    );
  });

  it('keeps a hand-added photo when nothing else changed, and a listing of only hand-added photos untouched', async () => {
    await firstImport();
    const hand = { ...record()!.media[0]!, id: 'hand_02', url: CommerceRecordNormalizer.mediaUri(PUBKY, 'hand_02') };
    delete (hand as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
    stored = stored.map((listing) => ({ ...listing, media: [...listing.media, hand] }));
    const { importer, planned } = await runImport(csvFor({ urls: [A, B, C], title: 'Socks and a hand photo' }));
    expect(fetched).toEqual([]);
    expect(record()?.media.map((media) => media.id)).toContain('hand_02');
    expect(await importer.resultCsv(planned.manifestId)).toContain(
      '"summary","photos unchanged, 1 kept (added in the Shop)"',
    );
  });

  it('keeps the stored photos and reports a failed new photo, rather than failing the listing', async () => {
    await firstImport();
    FAIL_URL = D;
    const { importer, planned } = await runImport(csvFor({ urls: [A, B, C, D], title: 'Socks, D fails' }));
    expect(record()?.title).toBe('Socks, D fails');
    expect(record()?.media).toHaveLength(3);
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain(`"sock-1","","","","${D}","failed","http_error"`);
    expect(csv).toContain('"summary","0 added, 0 removed"');
  });

  it('fails the listing, leaving the stored one alone, when every photo left the file and none was added by hand', async () => {
    await firstImport();
    const before = record();
    const { published } = await runImport(csvFor({ urls: [D], title: 'Socks, all new', price: '26' }));
    // D uploads, so the listing keeps one photo and is updated; the removals are all of A, B and C.
    expect(published).toMatchObject({ status: 'complete', published: 1 });
    expect(record()?.media).toHaveLength(1);
    expect(record()?.revision).toBe((before?.revision ?? 0) + 1);

    FAIL_URL = A;
    const second = await runImport(csvFor({ urls: [A], title: 'Socks, only a failing photo' }));
    expect(second.published).toMatchObject({ status: 'complete', published: 0, failed: 1 });
    expect(record()?.title).toBe('Socks, all new');
  });

  describe('on a live listing while a gate blocks (C16)', () => {
    it('keeps it active and reconciles its photos: one added, one removed', async () => {
      await firstImport();
      payment = NO_METHOD;
      const before = record()?.media.map((media) => media.id) ?? [];
      const { importer, planned, published } = await runImport(csvFor({ urls: [A, C, D], title: 'Socks, live' }));

      expect(planned.publishGate).toMatchObject({
        reason: 'no-method',
        pausing: 0,
        keptLive: [{ listingId: 'sock-1', title: 'Little Hodler Socks' }],
      });
      expect(fetched).toEqual([D]);
      expect(record()).toMatchObject({ state: 'active', title: 'Socks, live' });
      expect(record()?.media.map((media) => media.id)[0]).toBe(before[0]);
      expect(hashesOf(record())).toEqual([A, C, D].map(sourceUrlHash));
      expect(published).toMatchObject({ keptLive: 1, keptLiveReason: 'no-method' });
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain('"synced, kept live; fix payment method to keep publishing"');
      expect(csv).toContain('"summary","1 added, 1 removed"');
    });

    it('keeps it active and uploads nothing when its photos are unchanged', async () => {
      await firstImport();
      payment = NO_METHOD;
      const before = record()?.media;
      const { importer, planned } = await runImport(csvFor({ urls: [A, B, C], title: 'Socks, live again' }));
      expect(fetched).toEqual([]);
      expect(record()).toMatchObject({ state: 'active', title: 'Socks, live again' });
      expect(record()?.media).toEqual(before);
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain('kept live; fix payment method to keep publishing');
      expect(csv).toContain('"summary","photos unchanged"');
    });

    it('keeps the hand-added photo of a live listing too', async () => {
      await firstImport();
      const hand = { ...record()!.media[0]!, id: 'hand_03', url: CommerceRecordNormalizer.mediaUri(PUBKY, 'hand_03') };
      delete (hand as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
      stored = stored.map((listing) => ({ ...listing, media: [...listing.media, hand] }));
      payment = NO_METHOD;
      await runImport(csvFor({ urls: [A], title: 'Socks, live, fewer photos' }));
      expect(record()?.state).toBe('active');
      expect(record()?.media.map((media) => media.id)).toContain('hand_03');
      expect(record()?.media).toHaveLength(2);
    });
  });

  describe('URLs the file spells with surrounding spaces or more than once', () => {
    /** Rewrites the source URLs a preset kept on every row, the way a parser that does not trim would. */
    const respell = (urls: string[]) => (manifestId: string) => {
      void manifestId;
      for (const [key, value] of store.payloads) {
        const row = JSON.parse(value) as { extraFields: Record<string, string> };
        const images = urls.map((url) => ({ url, alt: 'Socks' }));
        store.payloads.set(
          key,
          JSON.stringify({
            ...row,
            extraFields: { ...row.extraFields, [SOURCE_IMAGE_URLS_FIELD]: JSON.stringify(images) },
          }),
        );
      }
    };

    it('uploads a URL with spaces around it once, attaches it, and reports it uploaded', async () => {
      const { importer, planned, targets } = await runImport(csvFor({ urls: [A] }), respell([` ${A} `]));
      expect(targets[0]?.images).toEqual([{ url: A, alt: 'Socks' }]);
      expect(fetched).toEqual([A]);
      expect(record()?.media).toHaveLength(1);
      expect(hashesOf(record())).toEqual([sourceUrlHash(A)]);
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain(`"${A}","uploaded"`);
      expect(csv).not.toContain('"failed"');
    });

    it('fetches the same URL once and attaches it once when it appears with and without spaces', async () => {
      await runImport(csvFor({ urls: [A] }), respell([` ${A}`, A, `${A}  `]));
      expect(fetched).toEqual([A]);
      expect(record()?.media).toHaveLength(1);
    });

    it('treats a re-import whose URLs only gained spaces as unchanged', async () => {
      await firstImport();
      const before = record()?.media;
      const { importer, planned } = await runImport(
        csvFor({ urls: [A, B, C], title: 'Socks, spaced URLs' }),
        respell([` ${A} `, B, ` ${C}`]),
      );
      expect(fetched).toEqual([]);
      expect(record()?.media).toEqual(before);
      expect(await importer.resultCsv(planned.manifestId)).toContain('"summary","photos unchanged"');
    });

    it('reads a Shopify row whose Image Src has spaces, uploads it once and attaches it', async () => {
      const shopify = new BytesFile(
        new TextEncoder().encode(
          [
            'Title,URL handle,Description,SKU,Option1 name,Option1 value,Price,Inventory quantity,Product image URL',
            `Little Hodler Socks,sock-1,Warm socks,sock-1,,,25.00,5,"  ${A}  "`,
          ].join('\n'),
        ),
        'shopify.csv',
        'text/csv',
      );
      await runImport(shopify);
      expect(fetched).toEqual([A]);
      expect(record()?.media).toHaveLength(1);
      expect(hashesOf(record())).toEqual([sourceUrlHash(A)]);
    });
  });

  it('puts a new listing through the whole photo phase and tags every photo', async () => {
    const { targets } = await runImport(csvFor({ urls: [A, B] }));
    expect(targets).toMatchObject([{ listingId: 'sock-1', images: [{ url: A }, { url: B }] }]);
    expect(targets[0]?.keptMedia).toBeUndefined();
    expect(hashesOf(record())).toEqual([A, B].map(sourceUrlHash));
  });
});
