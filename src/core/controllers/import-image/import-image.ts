import { ImportImageApplication } from '@/application/import-image/import-image';
import type { TImportImageFetchResult } from '@/application/import-image/import-image.types';
import { ImportImageValidators } from '@/pipes/import-image/import-image.validators';

export type TImportImageControllerParams = {
  url: unknown;
  remainingBytes: unknown;
  rateLimitKeys: string[];
  signal?: AbortSignal;
};

/**
 * Entry point for the import-image API route: validates the URL shape, then
 * delegates the guarded fetch.
 */
export class ImportImageController {
  private constructor() {}

  static async fetch({
    url,
    remainingBytes,
    rateLimitKeys,
    signal,
  }: TImportImageControllerParams): Promise<TImportImageFetchResult> {
    const validation = ImportImageValidators.validateUrl(url);
    if (!validation.ok) return { ok: false, reason: 'invalid_url' };

    return ImportImageApplication.fetch({
      url: validation.url,
      rateLimitKeys,
      remainingBytes: ImportImageValidators.parseRemainingBytes(remainingBytes),
      signal,
    });
  }
}
