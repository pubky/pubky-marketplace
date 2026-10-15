import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS } from '@/config/commerce';
import { parseCsvTable } from './import-csv-table';
import {
  altTextForUrl,
  extraFieldsWithImages,
  IMAGE_RESULTS_JSON_FIELD,
  imageResultsOf,
  type ImportImageResult,
  type ImportImageTarget,
  MEDIA_JSON_FIELD,
  outcomesFromResults,
  rowHoldsMedia,
  sourceImagesOf,
  uniqueImageUrls,
} from './import-image-phase';
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
