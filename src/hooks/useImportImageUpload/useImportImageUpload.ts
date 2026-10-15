'use client';

import { useRef, useState } from 'react';
import type { TImportImageMedia } from '@/application/import-image/import-image-upload';
import { IMPORT_IMAGE_MAX_COUNT, IMPORT_IMAGE_MAX_TOTAL_BYTES } from '@/config/import-image';
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
 * Enforces the per-import count and byte budgets.
 */
export async function uploadImportImages({
  ownerPubky,
  urls,
  altText,
  signal,
  onProgress,
}: TImportImageRunParams): Promise<TImportImageRunResult> {
  const trimmed = urls.map((url) => url.trim());
  const unique = [...new Set(trimmed)];
  const outcomes = new Map<string, TImportImageResult>();
  let fetchedBytes = 0;
  let done = 0;

  const report = (url: string | null) => onProgress?.({ done, total: unique.length, url });
  report(null);

  for (const [index, url] of unique.entries()) {
    const outcome = await uploadOne(url, index);
    outcomes.set(url, outcome);
    done += 1;
    report(url);
  }

  return { results: trimmed.map((url) => outcomes.get(url) as TImportImageResult), fetchedBytes };

  async function uploadOne(url: string, index: number): Promise<TImportImageResult> {
    if (signal?.aborted) return failed(url, 'cancelled');
    if (!ImportImageValidators.validateUrl(url).ok) return failed(url, 'invalid_url');
    if (index >= IMPORT_IMAGE_MAX_COUNT) return failed(url, 'limit_reached');

    const remainingBytes = IMPORT_IMAGE_MAX_TOTAL_BYTES - fetchedBytes;
    if (remainingBytes <= 0) return failed(url, 'budget_exceeded');

    const prepared = await ImportImageUploadController.fetchAndPrepare({
      ownerPubky,
      url,
      altText: altText?.(url, index) ?? DEFAULT_ALT_TEXT,
      remainingBytes,
      signal,
    });
    fetchedBytes += prepared.fetchedBytes;
    if (!prepared.ok) return failed(url, prepared.reason);

    try {
      await CommerceController.commitCreateMedia(prepared.media.id, prepared.bytes);
    } catch {
      return failed(url, 'upload_failed');
    }
    return { url, status: 'uploaded', media: prepared.media };
  }
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
