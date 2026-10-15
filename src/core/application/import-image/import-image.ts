import type { TImportImageFetchParams, TImportImageFetchResult } from '@/application/import-image/import-image.types';
import { NextJsImportImageService } from '@/services/nextjs/import-image/import-image';
import { ImportImageRateLimiter } from '@/services/nextjs/import-image/import-image.rate-limit';

/**
 * Server-side fetch of one seller-supplied image URL: rate limit, then the
 * guarded fetch, then byte accounting against every limiter key.
 */
export class ImportImageApplication {
  private constructor() {}

  static async fetch({
    url,
    rateLimitKeys,
    remainingBytes,
    signal,
  }: TImportImageFetchParams): Promise<TImportImageFetchResult> {
    for (const key of rateLimitKeys) {
      const decision = ImportImageRateLimiter.admit(key);
      if (!decision.ok) return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }

    const result = await NextJsImportImageService.fetch({ url, remainingBytes, signal });
    if (result.ok) {
      for (const key of rateLimitKeys) ImportImageRateLimiter.recordBytes(key, result.bytes.byteLength);
    }
    return result;
  }
}
