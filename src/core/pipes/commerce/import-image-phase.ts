import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
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

/** Extra field carrying how a re-import changed a stored listing's photos, for the result CSV. */
export const IMAGE_SYNC_JSON_FIELD = 'image_sync_json';
/**
 * Key on an uploaded media record that says which source image it came from:
 * a BLAKE3 hash of the source URL, not the URL. Media records are public, and
 * the merchant's web-shop image address is not something to publish; the hash
 * is enough to tell on a later import that a URL is the same, new or gone. The
 * record schema allows extra keys (`passthrough`), and media with no such key
 * was added by hand in the Shop.
 */
export const IMPORT_SOURCE_HASH_KEY = 'importSourceHash';

const DEFAULT_ALT_TEXT = 'Imported product photo';

/** What a re-import did to a stored listing's photos. */
export type ImageSync = {
  readonly added: number;
  readonly removed: number;
  /** Photos with no recorded source (added by hand in the Shop), left alone. */
  readonly handKept: number;
  readonly unchanged: boolean;
};

export type ImportImageTarget = {
  readonly listingId: string;
  /** Source images to fetch and upload: the URLs the stored listing does not already have. */
  readonly images: readonly SourceImage[];
  /** Source images left out because the listing is full (at most 13 media). */
  readonly skipped?: readonly SourceImage[];
  /** For a listing that already exists: the media it keeps, in the store's order. */
  readonly keptMedia?: readonly PresetJson[];
  /** For a listing that already exists: photos dropped because their source URL left the file, and hand-added ones kept. */
  readonly sync?: { readonly removed: number; readonly handKept: number };
};

/** What one listing got back from the photo phase. */
export type ListingImageOutcome = {
  readonly listingId: string;
  /** The media to publish: kept media first (the store's order), then newly uploaded ones in source order. */
  readonly media: readonly PresetJson[];
  readonly results: readonly TImportImageResultRow[];
  readonly sync?: ImageSync;
};

export type ImportImageResult = TImportImageResultRow & { readonly media?: PresetJson };

type PayloadRow = {
  media?: unknown;
  extraFields?: Record<string, string>;
};

/** The hash that identifies a source image URL on a media record. */
export function sourceUrlHash(url: string): string {
  return bytesToHex(blake3(utf8ToBytes(url.trim())));
}

function mediaSourceHash(media: unknown): string | undefined {
  if (typeof media !== 'object' || media === null) return undefined;
  const value = (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export type ImageSyncPlan = {
  /** New URLs to fetch and upload. */
  readonly toUpload: readonly SourceImage[];
  /** New URLs that do not fit in the listing. */
  readonly overflow: readonly SourceImage[];
  /** Stored media that stays, in the store's order. */
  readonly keptMedia: readonly PresetJson[];
  readonly removed: number;
  readonly handKept: number;
};

/**
 * Compares a stored listing's media with the source images in the file.
 * Media recorded from a URL still in the file is kept; media from a URL that
 * left the file is dropped; media with no recorded source (added by hand) is
 * always kept; URLs the listing does not have yet are uploaded, up to the
 * listing's media limit, after the kept media.
 */
export function planImageSync(
  storedMedia: readonly unknown[],
  desired: readonly SourceImage[],
  maxMedia: number,
): ImageSyncPlan {
  const wanted = new Set(desired.map((image) => sourceUrlHash(image.url)));
  const kept = storedMedia.filter((media) => {
    const hash = mediaSourceHash(media);
    return hash === undefined || wanted.has(hash);
  });
  const keptHashes = new Set(kept.map(mediaSourceHash).filter((hash): hash is string => hash !== undefined));
  const fresh: SourceImage[] = [];
  for (const image of desired) {
    const hash = sourceUrlHash(image.url);
    if (keptHashes.has(hash) || fresh.some((entry) => sourceUrlHash(entry.url) === hash)) continue;
    fresh.push(image);
  }
  const room = Math.max(0, maxMedia - kept.length);
  return {
    toUpload: fresh.slice(0, room),
    overflow: fresh.slice(room),
    keptMedia: JSON.parse(JSON.stringify(kept)) as PresetJson[],
    removed: storedMedia.length - kept.length,
    handKept: kept.filter((media) => mediaSourceHash(media) === undefined).length,
  };
}

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
    const media: PresetJson[] = [...(target.keptMedia ?? [])];
    const rows: TImportImageResultRow[] = [];
    let added = 0;
    for (const image of target.images) {
      const result = byUrl.get(image.url);
      if (result?.status === 'uploaded' && result.media !== undefined) {
        const record = result.media as Record<string, PresetJson>;
        media.push({ ...record, [IMPORT_SOURCE_HASH_KEY]: sourceUrlHash(image.url) });
        rows.push({ url: image.url, status: 'uploaded' });
        added += 1;
      } else {
        rows.push({
          url: image.url,
          status: 'failed',
          reason: result?.reason ?? 'cancelled',
        });
      }
    }
    for (const image of target.skipped ?? []) rows.push({ url: image.url, status: 'failed', reason: 'limit_reached' });
    const sync: ImageSync | undefined =
      target.keptMedia === undefined
        ? undefined
        : {
            added,
            removed: target.sync?.removed ?? 0,
            handKept: target.sync?.handKept ?? 0,
            unchanged:
              target.images.length === 0 && (target.skipped?.length ?? 0) === 0 && (target.sync?.removed ?? 0) === 0,
          };
    return { listingId: target.listingId, media, results: rows, ...(sync ? { sync } : {}) };
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
  if (outcome.sync) next[IMAGE_SYNC_JSON_FIELD] = JSON.stringify(outcome.sync);
  return next;
}

/** How a re-import changed a stored listing's photos, as stored on a row. */
export function imageSyncOf(row: PayloadRow): ImageSync | null {
  const parsed = parseJson(row.extraFields?.[IMAGE_SYNC_JSON_FIELD]);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { added, removed, handKept, unchanged } = parsed as Record<string, unknown>;
  if (
    typeof added !== 'number' ||
    typeof removed !== 'number' ||
    typeof handKept !== 'number' ||
    typeof unchanged !== 'boolean'
  ) {
    return null;
  }
  return { added, removed, handKept, unchanged };
}

/** The result CSV text for a re-imported listing's photos: `photos unchanged` or `n added, m removed`. */
export function imageSyncText(sync: ImageSync): string {
  const base = sync.unchanged ? 'photos unchanged' : `${sync.added} added, ${sync.removed} removed`;
  return sync.handKept > 0 ? `${base}, ${sync.handKept} kept (added in the Shop)` : base;
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
