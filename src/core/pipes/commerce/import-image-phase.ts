import { COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS } from '@/config/commerce';
import { IMPORT_IMAGE_RESULT_CSV_HEADER, importImageResultCells } from '@/pipes/import-image/import-image.csv';
import type { TImportImageResultRow } from '@/pipes/import-image/import-image.types';
import { isImportImageFailureReason } from '@/pipes/import-image/import-image.types';
import { type PresetJson, SOURCE_IMAGE_URLS_FIELD, type SourceImage } from './import-preset-rows';

/**
 * The photo phase of a shop-system import: which listings still need photos,
 * which URLs to fetch, and how the uploaded media and per-image results are
 * written back onto the planned rows. Pure: the fetching and uploading happen
 * in the hook through `uploadImportImages`.
 */

/** Extra field carrying the uploaded media records (a JSON array) that `mapCanonicalRowsToListing` reads. */
export const MEDIA_JSON_FIELD = 'media_json';
/** Extra field carrying the per-image results, so the result CSV survives a reload. */
export const IMAGE_RESULTS_JSON_FIELD = 'image_results_json';

const DEFAULT_ALT_TEXT = 'Imported product photo';

export type ImportImageTarget = {
  readonly listingId: string;
  readonly images: readonly SourceImage[];
};

/** What one listing got back from the photo phase. */
export type ListingImageOutcome = {
  readonly listingId: string;
  /** Uploaded media records in source order; failed images are not here. */
  readonly media: readonly PresetJson[];
  readonly results: readonly TImportImageResultRow[];
};

export type ImportImageResult = TImportImageResultRow & { readonly media?: PresetJson };

type PayloadRow = {
  media?: unknown;
  extraFields?: Record<string, string>;
};

function parseJson(value: string | undefined): unknown {
  if (value === undefined || value === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** The source image URLs a preset kept on a row, in source order; malformed entries are ignored. */
export function sourceImagesOf(row: PayloadRow): SourceImage[] {
  const parsed = parseJson(row.extraFields?.[SOURCE_IMAGE_URLS_FIELD]);
  if (!Array.isArray(parsed)) return [];
  const images: SourceImage[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { url, alt } = entry as { url?: unknown; alt?: unknown };
    if (typeof url === 'string' && url !== '') images.push({ url, alt: typeof alt === 'string' ? alt : '' });
  }
  return images;
}

/** A row already holding media records (uploaded earlier, or supplied by the file) is not fetched again. */
export function rowHoldsMedia(row: PayloadRow): boolean {
  const fromExtra = parseJson(row.extraFields?.[MEDIA_JSON_FIELD]);
  if (Array.isArray(fromExtra) && fromExtra.length > 0) return true;
  return Array.isArray(row.media) && row.media.length > 0;
}

/** Every distinct URL across the targets, in first-seen order. */
export function uniqueImageUrls(targets: readonly ImportImageTarget[]): string[] {
  const seen = new Set<string>();
  for (const target of targets) for (const image of target.images) seen.add(image.url);
  return [...seen];
}

/** The alt text for an image URL: the first listing title that used it, within the record limit. */
export function altTextForUrl(targets: readonly ImportImageTarget[], url: string): string {
  for (const target of targets) {
    const image = target.images.find((candidate) => candidate.url === url);
    const alt = image?.alt.trim();
    if (alt)
      return alt.length <= COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS ? alt : alt.slice(0, COMMERCE_MEDIA_ALT_TEXT_MAX_CHARS);
  }
  return DEFAULT_ALT_TEXT;
}

/**
 * Splits one run's results (one per input URL) back out per listing. A URL
 * used by several listings is uploaded once and its media record is shared.
 */
export function outcomesFromResults(
  targets: readonly ImportImageTarget[],
  results: readonly ImportImageResult[],
): ListingImageOutcome[] {
  const byUrl = new Map<string, ImportImageResult>();
  for (const result of results) if (!byUrl.has(result.url)) byUrl.set(result.url, result);
  return targets.map((target) => {
    const media: PresetJson[] = [];
    const rows: TImportImageResultRow[] = [];
    for (const image of target.images) {
      const result = byUrl.get(image.url);
      if (result?.status === 'uploaded' && result.media !== undefined) {
        media.push(result.media);
        rows.push({ url: image.url, status: 'uploaded' });
      } else {
        rows.push({
          url: image.url,
          status: 'failed',
          reason: result?.reason ?? 'cancelled',
        });
      }
    }
    return { listingId: target.listingId, media, results: rows };
  });
}

/** The row's extra fields after the photo phase: uploaded media in `media_json`, every result in `image_results_json`. */
export function extraFieldsWithImages(
  extraFields: Readonly<Record<string, string>>,
  outcome: ListingImageOutcome,
): Record<string, string> {
  const next: Record<string, string> = { ...extraFields };
  if (outcome.media.length > 0) next[MEDIA_JSON_FIELD] = JSON.stringify(outcome.media);
  else delete next[MEDIA_JSON_FIELD];
  next[IMAGE_RESULTS_JSON_FIELD] = JSON.stringify(outcome.results);
  return next;
}

/** The per-image results stored on a row, or an empty list. */
export function imageResultsOf(row: PayloadRow): TImportImageResultRow[] {
  const parsed = parseJson(row.extraFields?.[IMAGE_RESULTS_JSON_FIELD]);
  if (!Array.isArray(parsed)) return [];
  const results: TImportImageResultRow[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { url, status, reason } = entry as { url?: unknown; status?: unknown; reason?: unknown };
    if (typeof url !== 'string' || (status !== 'uploaded' && status !== 'failed')) continue;
    results.push({
      url,
      status,
      ...(isImportImageFailureReason(reason) ? { reason } : {}),
    });
  }
  return results;
}

export const RESULT_CSV_IMAGE_COLUMNS = IMPORT_IMAGE_RESULT_CSV_HEADER;

/** `[url, status, reason]` for the result CSV, with the URL neutralised against formula injection. */
export function imageResultCells(row: TImportImageResultRow): [string, string, string] {
  return importImageResultCells(row);
}
