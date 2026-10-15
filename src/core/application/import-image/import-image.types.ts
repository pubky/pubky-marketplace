import type { TImportImageFailureReason, TImportImageMimeType } from '@/pipes/import-image/import-image.types';

export type TImportImageFetchResult =
  | { ok: true; bytes: Uint8Array; mimeType: TImportImageMimeType }
  | { ok: false; reason: TImportImageFailureReason; status?: number; retryAfterSeconds?: number };

export type TImportImageFetchParams = {
  url: URL;
  rateLimitKeys: string[];
  remainingBytes: number | null;
  signal?: AbortSignal;
};
