import { IMPORT_IMAGE_MAX_COUNT } from '@/config/import-image';
import {
  altTextForUrl,
  distinctImageCount,
  type ImportImageResult,
  type ImportImageTarget,
  isDeferredImageResult,
  type ListingImageOutcome,
  normalizeImageUrl,
  outcomesFromResults,
  partialOutcome,
  planImageBatches,
  uniqueImageUrls,
} from '@/pipes/commerce/import-image-phase';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import { type TImportImageResult, uploadImportImages } from './useImportImageUpload';

/**
 * Finished listings are written to their rows in groups of this many as a batch
 * goes, and when a batch ends or the run is cancelled the photos already loaded for
 * a listing that is not finished are written too (as partial), so closing the
 * dialog loses nothing and losing the page costs only the photos of the one
 * listing under way.
 */
const ATTACH_EVERY_LISTINGS = 1;

export type TImageBatchProgress = {
  /** Distinct photos finished (loaded, or failed for their own reason) so far. */
  done: number;
  total: number;
  /** The batch being loaded, from 1. */
  batch: number;
  /** Batches planned so far; a batch that ran out of its byte budget adds one for what it left over. */
  batches: number;
};

export type TRunImportImageBatchesParams = {
  ownerPubky: string;
  /** The listings that still need photos: those whose rows hold no media yet. Read again on every resume. */
  loadTargets: () => Promise<ImportImageTarget[]>;
  /**
   * Photos of this import already stored on some listing's rows, by URL: a photo shared by listings on either
   * side of an interruption is reused instead of loaded again.
   */
  knownMedia?: (urls: string[]) => Promise<ReadonlyMap<string, PresetJson>>;
  /** Writes finished listings' media and results onto their planned rows, so a resume skips them. */
  attach: (outcomes: ListingImageOutcome[]) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: TImageBatchProgress) => void;
  onWait?: (secondsLeft: number | null) => void;
  upload?: typeof uploadImportImages;
};

export type TRunImportImageBatchesResult = {
  /**
   * `complete`: every listing has its photos or its genuine failures on its rows.
   * `interrupted`: the route would not serve more photos within the wait bound; listings not yet done are left as they were.
   * `cancelled`: the caller aborted.
   */
  status: 'complete' | 'interrupted' | 'cancelled';
  /** Listings left without their photos handled. */
  remaining: number;
  done: number;
  total: number;
};

/**
 * The photo phase of an import, in batches. Each batch is one `uploadImportImages`
 * run with its own count and byte budget (#229's caps), so a catalogue of any size
 * loads without a second import. After every batch the listings whose photos are
 * settled are written to their rows, so an interruption or reload resumes from the
 * next batch and a listing that already holds media is never fetched again.
 *
 * A photo that failed only because the run's budget ran out or the route said to
 * slow down says nothing about the photo: its listing is left for a later batch,
 * and a photo already loaded for it is reused, not uploaded again. A listing
 * counts as failed only for photos that failed for their own reason. If a whole
 * pass over the leftovers settles nothing (the route will not serve more within
 * the wait bound), the run stops as `interrupted` instead of failing them.
 */
export async function runImportImageBatches({
  ownerPubky,
  loadTargets,
  attach,
  knownMedia,
  signal,
  onProgress,
  onWait,
  upload = uploadImportImages,
}: TRunImportImageBatchesParams): Promise<TRunImportImageBatchesResult> {
  const targets = await loadTargets();
  if (targets.length === 0) return { status: 'complete', remaining: 0, done: 0, total: 0 };

  const total = distinctImageCount(targets);
  const settled = new Map<string, ImportImageResult>();
  for (const [url, media] of (await knownMedia?.(uniqueImageUrls(targets))) ?? []) {
    settled.set(url, { url, status: 'uploaded', media });
  }
  let queue = planImageBatches(targets, IMPORT_IMAGE_MAX_COUNT);
  let batches = queue.length;
  let batchNumber = 0;
  let leftOver: ImportImageTarget[] = [];
  let passSettled = 0;
  let listingsDone = 0;
  const partialWritten = new Map<string, number>();

  const report = (extra = 0) =>
    onProgress?.({ done: Math.min(total, settled.size + extra), total, batch: batchNumber, batches });
  const result = (status: TRunImportImageBatchesResult['status']): TRunImportImageBatchesResult => ({
    status,
    remaining: targets.length - listingsDone,
    done: settled.size,
    total,
  });

  while (queue.length > 0) {
    if (signal?.aborted) return result('cancelled');
    const batch = queue.shift() as ImportImageTarget[];
    batchNumber += 1;
    report();

    const urls = uniqueImageUrls(batch).filter((url) => !settled.has(url));
    const queued = new Set<ImportImageTarget>();
    const ready: ImportImageTarget[] = [];
    const markReady = () => {
      for (const target of batch) {
        if (queued.has(target)) continue;
        if (target.images.every((image) => settled.has(normalizeImageUrl(image.url)))) {
          queued.add(target);
          ready.push(target);
        }
      }
    };
    const flush = async () => {
      const group = ready.splice(0);
      if (group.length === 0) return;
      await attach(outcomesFromResults(group, [...settled.values()]));
      listingsDone += group.length;
      passSettled += group.length;
    };
    let flushing: Promise<void> = Promise.resolve();
    let flushError: unknown;
    const flushLater = () => {
      flushing = flushing.then(flush).catch((error: unknown) => {
        flushError ??= error;
      });
    };
    const settle = (entry: TImportImageResult) => {
      const url = normalizeImageUrl(entry.url);
      const mapped: ImportImageResult = {
        url,
        status: entry.status,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.media ? { media: JSON.parse(JSON.stringify(entry.media)) as PresetJson } : {}),
      };
      if (mapped.reason === 'cancelled' || isDeferredImageResult(mapped) || settled.has(url)) return;
      settled.set(url, mapped);
      passSettled += 1;
    };

    markReady();
    if (urls.length > 0) {
      const outcome = await upload({
        ownerPubky,
        urls,
        altText: (url) => altTextForUrl(batch, url),
        signal,
        onWait,
        onProgress: ({ done }) => report(done),
        onResult: (entry) => {
          settle(entry);
          markReady();
          if (ready.length >= ATTACH_EVERY_LISTINGS) flushLater();
        },
      });
      for (const entry of outcome.results) settle(entry);
    }
    markReady();
    flushLater();
    await flushing;
    if (flushError) throw flushError;
    const partial: ListingImageOutcome[] = [];
    for (const target of batch) {
      if (queued.has(target)) continue;
      leftOver.push(target);
      const outcome = partialOutcome(target, [...settled.values()]);
      if (outcome && partialWritten.get(target.listingId) !== outcome.media.length) {
        partialWritten.set(target.listingId, outcome.media.length);
        partial.push(outcome);
      }
    }
    if (partial.length > 0) await attach(partial);
    if (signal?.aborted) return result('cancelled');
    report();

    if (queue.length === 0 && leftOver.length > 0) {
      if (passSettled === 0) return result('interrupted');
      queue = planImageBatches(leftOver, IMPORT_IMAGE_MAX_COUNT);
      batches += queue.length;
      leftOver = [];
      passSettled = 0;
    }
  }
  return result('complete');
}
