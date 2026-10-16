import { IMPORT_STORE_PER_PAGE } from '@/config/import-store';
import { readStoreApiPage, readStoreApiProduct } from '@/pipes/import-store/import-store.product';
import { NextJsImportStoreService } from '@/services/nextjs/import-store/import-store';
import { ImportStoreRateLimiter } from '@/services/nextjs/import-store/import-store.rate-limit';
import type { TImportStoreFetchParams, TImportStoreFetchResult } from './import-store.types';

/**
 * Server-side read of one seller-supplied store address: rate limit, then the
 * guarded fetch, then the response trimmed to what the import reads, then byte
 * accounting against every limiter key. Nothing from the store goes back to the
 * browser except the trimmed products.
 */
export class ImportStoreApplication {
  private constructor() {}

  static async fetch({
    request,
    url,
    rateLimitKeys,
    remainingBytes,
    signal,
  }: TImportStoreFetchParams): Promise<TImportStoreFetchResult> {
    const global = ImportStoreRateLimiter.admitGlobal();
    if (!global.ok) return { ok: false, reason: 'rate_limited', retryAfterSeconds: global.retryAfterSeconds };

    for (const key of rateLimitKeys) {
      const decision = ImportStoreRateLimiter.admit(key);
      if (!decision.ok) return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }

    const fetched = await NextJsImportStoreService.fetchJson({ request, url, remainingBytes, signal });
    if (!fetched.ok) return fetched;

    ImportStoreRateLimiter.recordGlobalBytes(fetched.bytes);
    for (const key of rateLimitKeys) ImportStoreRateLimiter.recordBytes(key, fetched.bytes);

    if (request.kind === 'page') {
      const page = readStoreApiPage(fetched.json, IMPORT_STORE_PER_PAGE);
      if (!page.ok) return { ok: false, reason: 'not_woocommerce' };
      return {
        ok: true,
        response: {
          kind: 'page',
          products: page.products,
          rejected: page.rejected,
          total: fetched.total,
          totalPages: fetched.totalPages,
          bytes: fetched.bytes,
        },
      };
    }

    const product = readStoreApiProduct(fetched.json);
    if (!product) return { ok: false, reason: 'not_woocommerce' };
    return { ok: true, response: { kind: 'product', product, bytes: fetched.bytes } };
  }
}
