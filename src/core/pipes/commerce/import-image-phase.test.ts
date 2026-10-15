import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS } from '@/config/commerce';
import { parseCsvTable } from './import-csv-table';
import {
  altTextForUrl,
  distinctImageCount,
  estimatePhotoPauses,
  extraFieldsWithImages,
  IMAGE_RESULTS_JSON_FIELD,
  IMAGE_SYNC_JSON_FIELD,
  imageResultsOf,
  imageSyncOf,
  imageSyncText,
  IMPORT_SOURCE_HASH_KEY,
  type ImportImageResult,
  type ImportImageTarget,
  isDeferredImageResult,
  MEDIA_JSON_FIELD,
  normalizeImageUrl,
  outcomesFromResults,
  partialOutcome,
  PHOTOS_PARTIAL_FIELD,
  planImageBatches,
  planImageSync,
  rowHoldsMedia,
  sourceImagesOf,
  sourceUrlHash,
  uniqueImageUrls,
} from './import-image-phase';
import { SOURCE_IMAGE_URLS_FIELD } from './import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS } from './import-settings';
import { mapWooProductCsv } from './import-woo-csv';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');

function dezentralshopTargets(): ImportImageTarget[] {
  const parsed = parseCsvTable(readFileSync(resolve(FIXTURES, 'dezentralshop-woo-export-2026-10-15.csv'), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.reason);
  const { rows } = mapWooProductCsv({
    table: parsed.table,
    sellerPubky: 'y'.repeat(52),
    settings: { ...DEFAULT_IMPORT_SETTINGS, currency: 'CHF' },
    now: new Date('2026-10-15T00:00:00Z'),
  });
  const targets = new Map<string, ImportImageTarget>();
  for (const row of rows) {
    const images = sourceImagesOf(row);
    if (images.length > 0 && !targets.has(row.listingId))
      targets.set(row.listingId, { listingId: row.listingId, images });
  }
  return [...targets.values()];
}

type Recorded = { responses: { url: string; status: number; contentType: string; contentLength: number }[] };
const RECORDED = JSON.parse(readFileSync(resolve(FIXTURES, 'dezentralshop-image-headers.json'), 'utf8')) as Recorded;

function uploaded(url: string): ImportImageResult {
  return {
    url,
    status: 'uploaded',
    media: { id: `m${url.length}`, url: `pubky://x/media/${url.length}`, altText: 'x' },
  };
}

describe('source images of the real Dezentralshop file', () => {
  const targets = dezentralshopTargets();

  it('finds the photo URLs of the six listings that have photos, each served by dezentralshop.ch', () => {
    expect(targets.map((target) => [target.listingId, target.images.length])).toEqual([
      ['7718', 4],
      ['8106', 2],
      ['10507', 4],
      ['10578', 6],
      ['10977', 2],
      ['11769', 2],
    ]);
    const urls = uniqueImageUrls(targets);
    expect(urls).toHaveLength(20);
    expect(urls.every((url) => url.startsWith('https://dezentralshop.ch/wp-content/uploads/'))).toBe(true);
  });

  it('only fetches URLs the recorded responses show as images', () => {
    const recorded = new Map(RECORDED.responses.map((response) => [response.url, response]));
    for (const url of uniqueImageUrls(targets)) {
      expect(recorded.get(url)?.status).toBe(200);
      expect(recorded.get(url)?.contentType).toMatch(/^image\/(jpeg|png)$/);
    }
  });

  it('uses the listing title as alt text, within the record limit', () => {
    const [first] = targets;
    expect(altTextForUrl(targets, first!.images[0]!.url)).toBe('The Little Hodler Socks Bundle');
    expect(altTextForUrl(targets, 'https://elsewhere.example.com/x.jpg')).toBe('Imported product photo');
    const long: ImportImageTarget[] = [
      { listingId: 'a', images: [{ url: 'https://a.example.com/1.png', alt: 'A'.repeat(500) }] },
    ];
    expect(altTextForUrl(long, 'https://a.example.com/1.png')).toHaveLength(COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS);
  });
});

describe('outcomesFromResults', () => {
  const targets: ImportImageTarget[] = [
    {
      listingId: 'one',
      images: [
        { url: 'https://a.example.com/1.png', alt: 'One' },
        { url: 'https://a.example.com/2.png', alt: 'One' },
        { url: 'https://a.example.com/shared.png', alt: 'One' },
      ],
    },
    {
      listingId: 'two',
      images: [
        { url: 'https://a.example.com/shared.png', alt: 'Two' },
        { url: 'https://a.example.com/3.png', alt: 'Two' },
      ],
    },
  ];

  it('keeps uploaded media in source order, drops failed images, and shares a URL used twice', () => {
    const results: ImportImageResult[] = [
      uploaded('https://a.example.com/1.png'),
      { url: 'https://a.example.com/2.png', status: 'failed', reason: 'blocked_address' },
      uploaded('https://a.example.com/shared.png'),
      { url: 'https://a.example.com/3.png', status: 'failed', reason: 'not_image' },
    ];
    const outcomes = outcomesFromResults(targets, results);
    expect(outcomes[0]?.media).toHaveLength(2);
    expect(outcomes[0]?.results).toEqual([
      { url: 'https://a.example.com/1.png', status: 'uploaded' },
      { url: 'https://a.example.com/2.png', status: 'failed', reason: 'blocked_address' },
      { url: 'https://a.example.com/shared.png', status: 'uploaded' },
    ]);
    expect(outcomes[1]?.media).toHaveLength(1);
    expect(outcomes[1]?.media[0]).toEqual(outcomes[0]?.media[1]);
    expect(outcomes[1]?.results[1]).toEqual({
      url: 'https://a.example.com/3.png',
      status: 'failed',
      reason: 'not_image',
    });
  });

  it('treats a URL with no result as cancelled, and a listing with no uploads as having no media', () => {
    const outcomes = outcomesFromResults(targets, []);
    expect(outcomes.map((outcome) => outcome.media)).toEqual([[], []]);
    expect(outcomes[0]?.results.every((result) => result.status === 'failed' && result.reason === 'cancelled')).toBe(
      true,
    );
  });
});

describe('one form of every source URL', () => {
  const A = 'https://a.example.com/a.jpg';
  const rowWith = (urls: unknown[]) => ({ extraFields: { [SOURCE_IMAGE_URLS_FIELD]: JSON.stringify(urls) } });

  it('trims a URL once, where the row is read, and drops empty and repeated ones keeping the first', () => {
    const images = sourceImagesOf(
      rowWith([
        { url: ` ${A} `, alt: 'first' },
        { url: A, alt: 'second' },
        { url: '   ', alt: 'empty' },
        { url: `${A}\n`, alt: 'third' },
        { url: ' https://a.example.com/b.jpg', alt: 'b' },
        { alt: 'no url' },
        'junk',
      ]),
    );
    expect(images).toEqual([
      { url: A, alt: 'first' },
      { url: 'https://a.example.com/b.jpg', alt: 'b' },
    ]);
    expect(normalizeImageUrl(`\t${A} `)).toBe(A);
  });

  it('keys the fetch list, the alt text, the results and the hash on the same text', () => {
    const targets: ImportImageTarget[] = [{ listingId: 'one', images: [{ url: ` ${A} `, alt: 'Spaced' }] }];
    expect(uniqueImageUrls(targets)).toEqual([A]);
    expect(altTextForUrl(targets, A)).toBe('Spaced');
    expect(sourceUrlHash(` ${A} `)).toBe(sourceUrlHash(A));

    const outcome = outcomesFromResults(targets, [uploaded(A)])[0];
    expect(outcome?.results).toEqual([{ url: A, status: 'uploaded' }]);
    expect(outcome?.media).toHaveLength(1);
    expect((outcome?.media[0] as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY]).toBe(sourceUrlHash(A));
  });

  it('attaches one media, in the first occurrence order, when a new listing repeats a URL', () => {
    const B = 'https://a.example.com/b.jpg';
    const targets: ImportImageTarget[] = [
      {
        listingId: 'one',
        images: [
          { url: A, alt: 'A' },
          { url: B, alt: 'B' },
          { url: ` ${A}`, alt: 'A again' },
          { url: B, alt: 'B again' },
        ],
      },
    ];
    const outcome = outcomesFromResults(targets, [uploaded(A), uploaded(B)])[0];
    expect(outcome?.media).toHaveLength(2);
    expect(outcome?.media.map((media) => (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY])).toEqual([
      sourceUrlHash(A),
      sourceUrlHash(B),
    ]);
    expect(outcome?.results).toEqual([
      { url: A, status: 'uploaded' },
      { url: B, status: 'uploaded' },
    ]);
  });

  it('reports a repeated over-limit URL once, and never again when it was already reported', () => {
    const B = 'https://a.example.com/b.jpg';
    const targets: ImportImageTarget[] = [
      {
        listingId: 'one',
        images: [{ url: A, alt: '' }],
        skipped: [
          { url: B, alt: '' },
          { url: ` ${B} `, alt: '' },
          { url: ` ${A}`, alt: '' },
        ],
        keptMedia: [],
      },
    ];
    const outcome = outcomesFromResults(targets, [uploaded(A)])[0];
    expect(outcome?.results).toEqual([
      { url: A, status: 'uploaded' },
      { url: B, status: 'failed', reason: 'limit_reached' },
    ]);
  });

  it('reports a repeated URL once when it fails', () => {
    const targets: ImportImageTarget[] = [
      {
        listingId: 'one',
        images: [
          { url: A, alt: '' },
          { url: ` ${A} `, alt: '' },
        ],
      },
    ];
    const outcome = outcomesFromResults(targets, [{ url: A, status: 'failed', reason: 'not_image' }])[0];
    expect(outcome?.results).toEqual([{ url: A, status: 'failed', reason: 'not_image' }]);
  });
});

describe('writing the photo phase onto a row', () => {
  it('puts uploaded media in media_json and every result in image_results_json, and reads them back', () => {
    const fields = extraFieldsWithImages(
      { country_code: 'CH', source_image_urls: '[]' },
      {
        listingId: 'one',
        media: [{ id: 'm1' }],
        results: [
          { url: 'https://a.example.com/1.png', status: 'uploaded' },
          { url: '=HYPERLINK("x")', status: 'failed', reason: 'invalid_url' },
        ],
      },
    );
    expect(JSON.parse(fields[MEDIA_JSON_FIELD] ?? '[]')).toEqual([{ id: 'm1' }]);
    expect(fields.country_code).toBe('CH');
    expect(imageResultsOf({ extraFields: fields })).toEqual([
      { url: 'https://a.example.com/1.png', status: 'uploaded' },
      { url: '=HYPERLINK("x")', status: 'failed', reason: 'invalid_url' },
    ]);
    expect(IMAGE_RESULTS_JSON_FIELD in fields).toBe(true);
  });

  it('leaves out media_json when nothing uploaded, even if an earlier run wrote it', () => {
    const fields = extraFieldsWithImages(
      { [MEDIA_JSON_FIELD]: '[{"id":"old"}]' },
      {
        listingId: 'one',
        media: [],
        results: [{ url: 'https://a.example.com/1.png', status: 'failed', reason: 'network' }],
      },
    );
    expect(MEDIA_JSON_FIELD in fields).toBe(false);
  });

  it('knows a row that already holds media, from media_json or media, and ignores junk', () => {
    expect(rowHoldsMedia({ extraFields: { [MEDIA_JSON_FIELD]: '[{"id":"m"}]' } })).toBe(true);
    expect(rowHoldsMedia({ media: [{ id: 'm' }], extraFields: {} })).toBe(true);
    expect(rowHoldsMedia({ media: [], extraFields: { [MEDIA_JSON_FIELD]: '[]' } })).toBe(false);
    expect(rowHoldsMedia({ extraFields: { [MEDIA_JSON_FIELD]: 'not json' } })).toBe(false);
    expect(rowHoldsMedia({})).toBe(false);
    expect(sourceImagesOf({ extraFields: { source_image_urls: '{"a":1}' } })).toEqual([]);
    expect(
      sourceImagesOf({ extraFields: { source_image_urls: '[{"url":"https://a.example.com/1.png"},{"alt":"x"},3]' } }),
    ).toEqual([{ url: 'https://a.example.com/1.png', alt: '' }]);
    expect(imageResultsOf({ extraFields: { [IMAGE_RESULTS_JSON_FIELD]: '[{"url":"u","status":"odd"}]' } })).toEqual([]);
  });
});

describe('planImageSync', () => {
  const url = (name: string) => `https://dezentralshop.ch/wp-content/uploads/2025/12/${name}.jpg`;
  const source = (name: string) => ({ url: url(name), alt: name });
  const imported = (id: string, name: string) => ({ id, [IMPORT_SOURCE_HASH_KEY]: sourceUrlHash(url(name)) });
  const hand = (id: string) => ({ id });

  it('hashes the exact URL, so the same URL is always recognised and another never is', () => {
    expect(sourceUrlHash(url('a'))).toBe(sourceUrlHash(` ${url('a')} `));
    expect(sourceUrlHash(url('a'))).not.toBe(sourceUrlHash(url('b')));
    expect(sourceUrlHash(url('a'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps everything and uploads nothing when the URLs are the same', () => {
    const stored = [imported('m1', 'a'), imported('m2', 'b')];
    const plan = planImageSync(stored, [source('b'), source('a')], 13);
    expect(plan).toMatchObject({ toUpload: [], overflow: [], removed: 0, handKept: 0 });
    expect(plan.keptMedia).toEqual(stored);
  });

  it('uploads only the new URL, once, even if the file repeats it', () => {
    const plan = planImageSync([imported('m1', 'a')], [source('a'), source('c'), source('c')], 13);
    expect(plan.toUpload).toEqual([source('c')]);
    expect(plan.keptMedia).toEqual([imported('m1', 'a')]);
  });

  it('drops media whose URL left the file and keeps the store order of the rest', () => {
    const plan = planImageSync(
      [imported('m1', 'a'), imported('m2', 'b'), imported('m3', 'c')],
      [source('c'), source('a')],
      13,
    );
    expect(plan.keptMedia).toEqual([imported('m1', 'a'), imported('m3', 'c')]);
    expect(plan).toMatchObject({ removed: 1, toUpload: [] });
  });

  it('never drops a photo with no recorded source, wherever it sits, and counts it as kept', () => {
    const stored = [imported('m1', 'a'), hand('h1'), imported('m2', 'b')];
    const plan = planImageSync(stored, [source('a')], 13);
    expect(plan.keptMedia).toEqual([imported('m1', 'a'), hand('h1')]);
    expect(plan).toMatchObject({ removed: 1, handKept: 1, toUpload: [] });
    expect(planImageSync([hand('h1')], [], 13)).toMatchObject({ removed: 0, handKept: 1 });
  });

  it('uploads every source URL for a stored listing that has no recorded sources, beside its hand-added photos', () => {
    const plan = planImageSync([hand('h1'), hand('h2')], [source('a'), source('b')], 13);
    expect(plan.toUpload).toEqual([source('a'), source('b')]);
    expect(plan.handKept).toBe(2);
  });

  it('adds only what fits under the listing media limit and returns the rest as overflow', () => {
    const stored = Array.from({ length: 12 }, (_, index) => imported(`m${index}`, `s${index}`));
    const desired = [...stored.map((_, index) => source(`s${index}`)), source('x'), source('y')];
    const plan = planImageSync(stored, desired, 13);
    expect(plan.toUpload).toEqual([source('x')]);
    expect(plan.overflow).toEqual([source('y')]);
  });
});

describe('re-import outcomes', () => {
  const url = (name: string) => `https://dezentralshop.ch/wp-content/uploads/2025/12/${name}.jpg`;
  const stored = { id: 'm1', [IMPORT_SOURCE_HASH_KEY]: sourceUrlHash(url('a')) };

  it('puts kept media first, then the new upload tagged with its source hash, and counts the sync', () => {
    const target: ImportImageTarget = {
      listingId: 'sock-1',
      images: [{ url: url('b'), alt: 'Socks' }],
      keptMedia: [stored],
      sync: { removed: 1, handKept: 0 },
    };
    const [outcome] = outcomesFromResults([target], [uploaded(url('b'))]);
    expect(outcome?.media).toHaveLength(2);
    expect(outcome?.media[0]).toEqual(stored);
    expect(outcome?.media[1]).toMatchObject({ [IMPORT_SOURCE_HASH_KEY]: sourceUrlHash(url('b')) });
    expect(outcome?.sync).toEqual({ added: 1, removed: 1, handKept: 0, unchanged: false });
  });

  it('is unchanged when nothing is fetched, nothing removed and nothing skipped', () => {
    const target: ImportImageTarget = {
      listingId: 'sock-1',
      images: [],
      keptMedia: [stored],
      sync: { removed: 0, handKept: 2 },
    };
    const [outcome] = outcomesFromResults([target], []);
    expect(outcome?.media).toEqual([stored]);
    expect(outcome?.sync).toEqual({ added: 0, removed: 0, handKept: 2, unchanged: true });
  });

  it('reports a failed or overflowing new photo and does not count it as added', () => {
    const target: ImportImageTarget = {
      listingId: 'sock-1',
      images: [{ url: url('b'), alt: 'Socks' }],
      skipped: [{ url: url('c'), alt: 'Socks' }],
      keptMedia: [stored],
      sync: { removed: 0, handKept: 0 },
    };
    const [outcome] = outcomesFromResults([target], [{ url: url('b'), status: 'failed', reason: 'http_error' }]);
    expect(outcome?.results).toEqual([
      { url: url('b'), status: 'failed', reason: 'http_error' },
      { url: url('c'), status: 'failed', reason: 'limit_reached' },
    ]);
    expect(outcome?.sync).toMatchObject({ added: 0, unchanged: false });
  });

  it('leaves a new listing without a sync summary, and stores and words the summary for an existing one', () => {
    const [fresh] = outcomesFromResults([{ listingId: 'new', images: [] }], []);
    expect(fresh?.sync).toBeUndefined();
    const fields = extraFieldsWithImages(
      {},
      {
        listingId: 'sock-1',
        media: [{ id: 'm1' }],
        results: [],
        sync: { added: 2, removed: 1, handKept: 1, unchanged: false },
      },
    );
    expect(imageSyncOf({ extraFields: fields })).toEqual({ added: 2, removed: 1, handKept: 1, unchanged: false });
    expect(IMAGE_SYNC_JSON_FIELD in fields).toBe(true);
    expect(imageSyncText({ added: 2, removed: 1, handKept: 1, unchanged: false })).toBe(
      '2 added, 1 removed, 1 kept (added in the Shop)',
    );
    expect(imageSyncText({ added: 0, removed: 0, handKept: 0, unchanged: true })).toBe('photos unchanged');
    expect(imageSyncText({ added: 0, removed: 0, handKept: 2, unchanged: true })).toBe(
      'photos unchanged, 2 kept (added in the Shop)',
    );
    expect(imageSyncOf({ extraFields: { [IMAGE_SYNC_JSON_FIELD]: '{"added":"x"}' } })).toBeNull();
  });
});

describe('photo batches', () => {
  const target = (listingId: string, urls: string[]): ImportImageTarget => ({
    listingId,
    images: urls.map((url) => ({ url, alt: listingId })),
  });
  const MAX = 500;
  /** `count` listings of `perListing` distinct photos each, 5 by default: 145 listings are 725 photos. */
  const listings = (count: number, perListing = 5) =>
    Array.from({ length: count }, (_, index) =>
      target(
        `l${index}`,
        Array.from({ length: perListing }, (_, photo) => `https://shop.example.com/${index}/${photo}.jpg`),
      ),
    );

  it('puts 725 photos in two batches, in listing order, the first full and the second the rest', () => {
    const targets = listings(145);
    expect(distinctImageCount(targets)).toBe(725);
    const batches = planImageBatches(targets, MAX);
    expect(batches.map((batch) => distinctImageCount(batch))).toEqual([500, 225]);
    expect(batches.flat().map((entry) => entry.listingId)).toEqual(targets.map((entry) => entry.listingId));
  });

  it('is one batch up to the cap, and none for nothing', () => {
    expect(planImageBatches(listings(100), MAX)).toHaveLength(1);
    expect(planImageBatches(listings(101), MAX)).toHaveLength(2);
    expect(planImageBatches([], MAX)).toEqual([]);
  });

  it('never splits a listing across batches', () => {
    const batches = planImageBatches([target('a', ['u1', 'u2', 'u3']), target('b', ['u4', 'u5', 'u6'])], 4);
    expect(batches.map((batch) => batch.map((entry) => entry.listingId))).toEqual([['a'], ['b']]);
  });

  it('counts a photo shared by listings once, within a batch', () => {
    const shared = [target('a', ['u1', 'u2']), target('b', ['u2', 'u3']), target('c', ['u3', 'u1'])];
    expect(distinctImageCount(shared)).toBe(3);
    expect(planImageBatches(shared, 3)).toHaveLength(1);
  });

  it('takes listings that need no fetch along in whatever batch they fall in', () => {
    const unchanged: ImportImageTarget = { listingId: 'kept', images: [], keptMedia: [] };
    const batches = planImageBatches([unchanged, target('a', ['u1', 'u2']), unchanged, target('b', ['u3'])], 2);
    expect(batches.map((batch) => batch.map((entry) => entry.listingId))).toEqual([['kept', 'a', 'kept'], ['b']]);
  });

  it('compares photos on the normalised URL, so spaces do not make two batches', () => {
    const batches = planImageBatches([target('a', ['u1', ' u1 ']), target('b', [' u1'])], 1);
    expect(batches).toHaveLength(1);
  });

  it('tells a failure of the run (its budget, the route asking to slow down) from a failure of the photo', () => {
    for (const reason of ['budget_exceeded', 'limit_reached', 'rate_limited'] as const) {
      expect(isDeferredImageResult({ status: 'failed', reason })).toBe(true);
    }
    for (const reason of [
      'not_image',
      'too_large',
      'http_error',
      'blocked_address',
      'decode_failed',
      'upload_failed',
      'invalid_url',
      'timeout',
      'network',
      'cancelled',
    ] as const) {
      expect(isDeferredImageResult({ status: 'failed', reason })).toBe(false);
    }
    expect(isDeferredImageResult({ status: 'uploaded' })).toBe(false);
    expect(isDeferredImageResult({ status: 'failed' })).toBe(false);
  });
});

describe('photos loaded for a listing that is not finished', () => {
  const A = 'https://a.example.com/a.jpg';
  const B = 'https://a.example.com/b.jpg';
  const C = 'https://a.example.com/c.jpg';
  const target: ImportImageTarget = {
    listingId: 'one',
    images: [A, B, C].map((url) => ({ url, alt: 'One' })),
  };

  it('is what loaded so far, marked partial, with no summary of changes', () => {
    const outcome = partialOutcome(target, [
      uploaded(A),
      { url: B, status: 'failed', reason: 'budget_exceeded' },
      uploaded(C),
    ]);
    expect(outcome).toMatchObject({ listingId: 'one', partial: true });
    expect(outcome?.media).toHaveLength(2);
    expect(outcome?.results.map((entry) => [entry.url, entry.status])).toEqual([
      [A, 'uploaded'],
      [C, 'uploaded'],
    ]);
    expect(outcome?.sync).toBeUndefined();
  });

  it('is nothing when no photo of the listing has loaded', () => {
    expect(partialOutcome(target, [])).toBeNull();
    expect(partialOutcome(target, [{ url: A, status: 'failed', reason: 'not_image' }])).toBeNull();
  });

  it('keeps the media a stored listing already has, ahead of the new ones', () => {
    const stored = { id: 'stored-1', importSourceHash: sourceUrlHash('https://old.example.com/x.jpg') };
    const outcome = partialOutcome({ ...target, keptMedia: [stored] }, [uploaded(A)]);
    expect(outcome?.media).toHaveLength(2);
    expect(outcome?.media[0]).toEqual(stored);
  });

  it('writes a flag a resume can read: the row holds media to reuse but is not taken for finished', () => {
    const partial = partialOutcome(target, [uploaded(A)])!;
    const written = extraFieldsWithImages({}, partial);
    expect(written[PHOTOS_PARTIAL_FIELD]).toBe('1');
    expect(written[MEDIA_JSON_FIELD]).toBeDefined();
    expect(rowHoldsMedia({ extraFields: written })).toBe(false);
    expect(sourceHashesOf(written)).toEqual([sourceUrlHash(A)]);
  });

  it('is replaced by the final outcome, which clears the flag and makes the row finished', () => {
    const partial = extraFieldsWithImages({}, partialOutcome(target, [uploaded(A)])!);
    const final = outcomesFromResults([target], [uploaded(A), uploaded(B), uploaded(C)])[0]!;
    const written = extraFieldsWithImages(partial, final);
    expect(written[PHOTOS_PARTIAL_FIELD]).toBeUndefined();
    expect(rowHoldsMedia({ extraFields: written })).toBe(true);
    expect(sourceHashesOf(written)).toHaveLength(3);
  });

  function sourceHashesOf(fields: Record<string, string>): unknown[] {
    return (JSON.parse(fields[MEDIA_JSON_FIELD] ?? '[]') as Record<string, unknown>[]).map(
      (media) => media[IMPORT_SOURCE_HASH_KEY],
    );
  }
});

describe('estimatePhotoPauses', () => {
  const KB = 1024;
  const MB = 1024 * KB;

  it('counts the times the byte allowance runs out: the photos at a typical size over one window, less the first window', () => {
    expect(estimatePhotoPauses(100, 300 * KB, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(500, 300 * KB, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(512, 300 * KB, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(513, 300 * KB, 150 * MB)).toBe(1);
    expect(estimatePhotoPauses(725, 300 * KB, 150 * MB)).toBe(1);
    expect(estimatePhotoPauses(1_024, 300 * KB, 150 * MB)).toBe(1);
    expect(estimatePhotoPauses(1_025, 300 * KB, 150 * MB)).toBe(2);
    expect(estimatePhotoPauses(2_000, 300 * KB, 150 * MB)).toBe(3);
  });

  it('is zero for nothing to load or a size or allowance that makes no sense', () => {
    expect(estimatePhotoPauses(0, 300 * KB, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(-5, 300 * KB, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(900, 0, 150 * MB)).toBe(0);
    expect(estimatePhotoPauses(900, 300 * KB, 0)).toBe(0);
  });
});
