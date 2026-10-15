import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { uploadImportImages } from '@/hooks/useImportImageUpload/useImportImageUpload';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import {
  altTextForUrl,
  IMAGE_RESULTS_JSON_FIELD,
  type ImportImageResult,
  MEDIA_JSON_FIELD,
  outcomesFromResults,
  uniqueImageUrls,
} from '@/pipes/commerce/import-image-phase';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS } from '@/pipes/commerce/import-settings';
import type { SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);
const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');
const CHF = { ...DEFAULT_IMPORT_SETTINGS, currency: 'CHF', countryCode: 'CH' };

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

type Recorded = { responses: { url: string; status: number; contentType: string; contentLength: number }[] };
const RECORDED = new Map(
  (JSON.parse(readFileSync(resolve(FIXTURES, 'dezentralshop-image-headers.json'), 'utf8')) as Recorded).responses.map(
    (response) => [response.url, response],
  ),
);

/** Two of the real URLs are made to fail; every other URL succeeds as its recorded response says. */
const FAILING = new Map<string, 'http_error' | 'blocked_address'>([
  ['https://dezentralshop.ch/wp-content/uploads/2025/12/Socken-II-scaled-1.jpg', 'http_error'],
  ['https://dezentralshop.ch/wp-content/uploads/2025/12/Orange-Pill-chill.png', 'blocked_address'],
  ['https://dezentralshop.ch/wp-content/uploads/2025/12/Orange-Pill-Chill-I.png', 'blocked_address'],
]);

function stubbedPrepare(params: { url: string; altText: string }): TImportImagePrepareResult {
  const failure = FAILING.get(params.url);
  if (failure) return { ok: false, reason: failure, fetchedBytes: 0 };
  const recorded = RECORDED.get(params.url);
  if (!recorded) return { ok: false, reason: 'http_error', fetchedBytes: 0 };
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

describe('the photo phase over the real Dezentralshop export (recorded responses, no network)', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let fetched: string[];
  let written: string[];

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    fetched = [];
    written = [];
    vi.restoreAllMocks();
    vi.spyOn(ImportImageUploadController, 'fetchAndPrepare').mockImplementation(async (params) => {
      fetched.push(params.url);
      return stubbedPrepare(params);
    });
    vi.spyOn(CommerceController, 'commitCreateMedia').mockImplementation(async (id) => {
      written.push(String(id));
      return `pubky://${PUBKY}/media/${id}`;
    });
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

  async function plan() {
    const importer = app();
    const planned = await importer.planFile(
      new BytesFile(
        new Uint8Array(readFileSync(resolve(FIXTURES, 'dezentralshop-woo-export-2026-10-15.csv'))),
        'export.csv',
        'text/csv',
      ),
      CHF,
    );
    if (planned.status !== 'planned') throw new Error('plan');
    return { importer, manifestId: planned.manifestId };
  }

  /** The same sequence the import hook runs between plan and publish. */
  async function photoPhase(importer: ReturnType<typeof app>, manifestId: string) {
    const targets = await importer.imageTargets(manifestId);
    const urls = uniqueImageUrls(targets);
    const progress: number[] = [];
    const outcome = await uploadImportImages({
      ownerPubky: PUBKY,
      urls,
      altText: (url) => altTextForUrl(targets, url),
      onProgress: ({ done }) => progress.push(done),
    });
    const results: ImportImageResult[] = outcome.results.map((result) => ({
      url: result.url,
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.media ? { media: JSON.parse(JSON.stringify(result.media)) as PresetJson } : {}),
    }));
    await importer.attachImages(manifestId, outcomesFromResults(targets, results));
    return { targets, urls, progress, outcome };
  }

  it('finds the six listings with photos after the plan, and no listing without photo links', async () => {
    const { importer, manifestId } = await plan();
    const targets = await importer.imageTargets(manifestId);
    expect(targets.map((target) => target.listingId)).toEqual(['7718', '8106', '10507', '10578', '10977', '11769']);
    expect(uniqueImageUrls(targets)).toHaveLength(20);
  });

  it('uploads each distinct photo once with progress, and writes media onto the rows', async () => {
    const { importer, manifestId } = await plan();
    const { urls, progress, outcome } = await photoPhase(importer, manifestId);

    expect(fetched).toEqual(urls);
    expect(progress).toEqual([0, ...Array.from({ length: 20 }, (_, index) => index + 1)]);
    expect(written).toHaveLength(17);
    expect(outcome.fetchedBytes).toBeGreaterThan(0);

    const payloads = [...store.payloads.values()].map(
      (value) => JSON.parse(value) as { listingId: string; extraFields: Record<string, string> },
    );
    const socks = payloads.filter((row) => row.listingId === '7718');
    expect(socks).toHaveLength(2);
    for (const row of socks) {
      const media = JSON.parse(row.extraFields[MEDIA_JSON_FIELD] ?? '[]') as { altText: string; mimeType: string }[];
      expect(media).toHaveLength(3);
      expect(media.every((item) => item.altText === 'The Little Hodler Socks Bundle')).toBe(true);
    }
    const noPhotos = payloads.filter((row) => row.listingId === '11769');
    expect(noPhotos.every((row) => !(MEDIA_JSON_FIELD in row.extraFields))).toBe(true);
    expect(noPhotos.every((row) => IMAGE_RESULTS_JSON_FIELD in row.extraFields)).toBe(true);
  });

  it('drops failed images, publishes listings with photos, and fails a listing with none as photo_required', async () => {
    const { importer, manifestId } = await plan();
    await photoPhase(importer, manifestId);

    const published = await importer.publish(manifestId);

    expect(published).toMatchObject({ status: 'complete', published: 5, synced: 15, failed: 5, mixed: true });
    expect(published.status === 'complete' && published.message).toMatch(/^2 listings need a photo/);
    expect(puts.map((record) => record.listingId).sort()).toEqual(['10507', '10578', '10977', '7718', '8106']);
    const socks = puts.find((record) => record.listingId === '7718');
    expect(socks?.media).toHaveLength(3);
    expect(socks?.media.every((item) => item.url.startsWith(`pubky://${PUBKY}/`))).toBe(true);
    expect(puts.some((record) => record.listingId === '11769')).toBe(false);
    // TEST has no photo link at all, so it fails the same way as the listing whose photos all failed.
    expect(puts.find((record) => record.listingId === 'woo-3799')).toBeUndefined();
  });

  it('writes one line per image into the result CSV and keeps the listing rows', async () => {
    const { importer, manifestId } = await plan();
    await photoPhase(importer, manifestId);
    await importer.publish(manifestId);

    const csv = await importer.resultCsv(manifestId);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('listing_id,row_identity,checkpoint,result,image_url,image_status,image_reason');
    expect(lines.filter((line) => line.includes('"uploaded"'))).toHaveLength(17);
    expect(csv).toContain(
      '"7718","","","","https://dezentralshop.ch/wp-content/uploads/2025/12/Socken-II-scaled-1.jpg","failed","http_error"',
    );
    expect(csv).toContain(
      '"11769","","","","https://dezentralshop.ch/wp-content/uploads/2025/12/Orange-Pill-chill.png","failed","blocked_address"',
    );
    expect(csv).toContain('"photo_required"');
    expect(lines.filter((line) => line.includes('"synced"'))).toHaveLength(15);
    expect(lines.filter((line) => line.includes('"photo_required"'))).toHaveLength(5);
  });

  it('skips listings that already hold media on a second run, and retries only the one with none', async () => {
    const { importer, manifestId } = await plan();
    await photoPhase(importer, manifestId);
    const before = fetched.length;

    const targets = await importer.imageTargets(manifestId);
    expect(targets.map((target) => target.listingId)).toEqual(['11769']);

    FAILING.clear();
    await photoPhase(importer, manifestId);
    expect(fetched.slice(before)).toEqual([
      'https://dezentralshop.ch/wp-content/uploads/2025/12/Orange-Pill-chill.png',
      'https://dezentralshop.ch/wp-content/uploads/2025/12/Orange-Pill-Chill-I.png',
    ]);
    expect(await importer.imageTargets(manifestId)).toEqual([]);

    const published = await importer.publish(manifestId);
    expect(published).toMatchObject({ status: 'complete', published: 6, synced: 19, failed: 1, mixed: true });
  });

  it('uses the result CSV header unchanged when no photo phase ran', async () => {
    const { importer, manifestId } = await plan();
    const csv = await importer.resultCsv(manifestId);
    expect(csv.split('\n')[0]).toBe('listing_id,row_identity,checkpoint,result');
  });

  it('makes no change for a file without photo links', async () => {
    const importer = app();
    const planned = await importer.planFile(
      new BytesFile(
        new TextEncoder().encode('ID,Type,SKU,Name,Regular price,In stock?,Stock\n1,simple,a,Plain item,5,1,3\n'),
        'plain.csv',
        'text/csv',
      ),
    );
    if (planned.status !== 'planned') throw new Error('plan');
    expect(await importer.imageTargets(planned.manifestId)).toEqual([]);
    await importer.attachImages(planned.manifestId, []);
    expect(fetched).toEqual([]);
  });
});
