import { ImportStoreApplication } from '@/application/import-store/import-store';
import type { TImportStoreFetchResult } from '@/application/import-store/import-store.types';
import { IMPORT_STORE_MAX_PAGES } from '@/config/import-store';
import { ImportStoreValidators } from '@/pipes/import-store/import-store.validators';

export type TImportStoreControllerParams = {
  body: unknown;
  rateLimitKeys: string[];
  signal?: AbortSignal;
};

/**
 * Entry point for the import-store API route: validates the request shape and
 * builds the one URL it may fetch, then delegates the guarded read.
 */
export class ImportStoreController {
  private constructor() {}

  static async fetch({ body, rateLimitKeys, signal }: TImportStoreControllerParams): Promise<TImportStoreFetchResult> {
    const validation = ImportStoreValidators.validateRequest(body, IMPORT_STORE_MAX_PAGES);
    if (!validation.ok) return { ok: false, reason: 'invalid_url' };

    const remaining =
      typeof body === 'object' && body !== null ? (body as { remainingBytes?: unknown }).remainingBytes : undefined;
    return ImportStoreApplication.fetch({
      request: validation.request,
      url: validation.url,
      rateLimitKeys,
      remainingBytes: ImportStoreValidators.parseRemainingBytes(remaining),
      signal,
    });
  }
}
