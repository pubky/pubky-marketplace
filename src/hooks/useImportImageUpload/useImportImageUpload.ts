'use client';

import { useRef, useState } from 'react';
import type { TImportImageMedia } from '@/application/import-image/import-image-upload';
import {
  IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS,
  IMPORT_IMAGE_MAX_COUNT,
  IMPORT_IMAGE_MAX_TOTAL_BYTES,
  IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS,
} from '@/config/import-image';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import type { TImportImageResultRow } from '@/pipes/import-image/import-image.types';
import { ImportImageValidators } from '@/pipes/import-image/import-image.validators';

export type TImportImageResult = TImportImageResultRow & {
  /** Present when `status` is `uploaded`: the record to put on the listing. */
  media?: TImportImageMedia;
};

export type TImportImageProgress = { done: number; total: number; url: string | null };

export type TImportImageRunParams = {
  ownerPubky: string;
  /** One entry per image reference in the import file, in file order. Duplicates share one upload. */
  urls: string[];
  altText?: (url: string, index: number) => string;
  signal?: AbortSignal;
  onProgress?: (progress: TImportImageProgress) => void;
  /** Called every second with the seconds left while the route asks the client to wait, and with `null` when the wait is over. */
  onWait?: (secondsLeft: number | null) => void;
  /** Called with each distinct photo's outcome as soon as it is known, before the run ends. */
  onResult?: (result: TImportImageResult) => void;
  /**
   * Called with a photo's media record after it is prepared and before its file is written, and awaited. A caller
   * that records it there can find the file again if the page is lost before the upload is recorded as done.
   * An error here stops the run before the file is written.
   */
  onPrepared?: (url: string, media: TImportImageMedia) => Promise<void>;
};

export type TImportImageRunResult = {
  /** One result per input entry, in input order. */
  results: TImportImageResult[];
  fetchedBytes: number;
};

const DEFAULT_ALT_TEXT = 'Imported product photo';

/**
 * Fetches each image URL through the server route and writes the bytes to the
 * signed-in seller's homeserver through `CommerceController.commitCreateMedia`.
 * One image failing never stops the run: it becomes a `failed` result with a reason.
 * Enforces the per-run count and byte budgets. When the route answers
 * `rate_limited` with a `Retry-After`, the run waits that long (reporting it
 * through `onWait`) and tries the image again; a wait over
 * `IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS`, or more waiting in all than
 * `IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS`, gives the image up as `rate_limited`.
 */
export async function uploadImportImages({
  ownerPubky,
  urls,
  altText,
  signal,
  onProgress,
  onWait,
  onResult,
  onPrepared,
}: TImportImageRunParams): Promise<TImportImageRunResult> {
  const trimmed = urls.map((url) => url.trim());
  const unique = [...new Set(trimmed)];
  const outcomes = new Map<string, TImportImageResult>();
  let fetchedBytes = 0;
  let done = 0;
  let waitedSeconds = 0;

  const report = (url: string | null) => onProgress?.({ done, total: unique.length, url });
  report(null);

  for (const [index, url] of unique.entries()) {
    const outcome = await uploadOne(url, index);
    outcomes.set(url, outcome);
    onResult?.(outcome);
    done += 1;
    report(url);
  }

  return { results: trimmed.map((url) => outcomes.get(url) as TImportImageResult), fetchedBytes };

  async function uploadOne(url: string, index: number): Promise<TImportImageResult> {
    if (signal?.aborted) return failed(url, 'cancelled');
    if (!ImportImageValidators.validateUrl(url).ok) return failed(url, 'invalid_url');
    if (index >= IMPORT_IMAGE_MAX_COUNT) return failed(url, 'limit_reached');

    let prepared: Awaited<ReturnType<typeof ImportImageUploadController.fetchAndPrepare>>;
    for (;;) {
      const remainingBytes = IMPORT_IMAGE_MAX_TOTAL_BYTES - fetchedBytes;
      if (remainingBytes <= 0) return failed(url, 'budget_exceeded');

      prepared = await ImportImageUploadController.fetchAndPrepare({
        ownerPubky,
        url,
        altText: altText?.(url, index) ?? DEFAULT_ALT_TEXT,
        remainingBytes,
        signal,
      });
      fetchedBytes += prepared.fetchedBytes;
      if (prepared.ok || prepared.reason !== 'rate_limited' || prepared.retryAfterSeconds === undefined) break;

      const wait = prepared.retryAfterSeconds;
      if (wait > IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS || waitedSeconds + wait > IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS) {
        return failed(url, 'rate_limited');
      }
      waitedSeconds += wait;
      if (!(await countdown(wait))) return failed(url, 'cancelled');
    }
    if (!prepared.ok) return failed(url, prepared.reason);

    await onPrepared?.(url, prepared.media);
    try {
      await CommerceController.commitCreateMedia(prepared.media.id, prepared.bytes);
    } catch {
      return failed(url, 'upload_failed');
    }
    return { url, status: 'uploaded', media: prepared.media };
  }

  async function countdown(seconds: number): Promise<boolean> {
    try {
      for (let left = Math.ceil(seconds); left > 0; left -= 1) {
        onWait?.(left);
        if (!(await sleep(1000, signal))) return false;
      }
      return true;
    } finally {
      onWait?.(null);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function failed(url: string, reason: NonNullable<TImportImageResultRow['reason']>): TImportImageResult {
  return { url, status: 'failed', reason };
}

export function useImportImageUpload(ownerPubky: string | null) {
  const [progress, setProgress] = useState<TImportImageProgress | null>(null);
  const [results, setResults] = useState<TImportImageResult[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (
    urls: string[],
    altText?: TImportImageRunParams['altText'],
  ): Promise<TImportImageRunResult | null> => {
    if (!ownerPubky || running) return null;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: new Set(urls.map((url) => url.trim())).size, url: null });
    try {
      const outcome = await uploadImportImages({
        ownerPubky,
        urls,
        altText,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResults(outcome.results);
      return outcome;
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => abortRef.current?.abort();

  return { run, cancel, running, progress, results };
}
