import type {
  TImportStoreFailureReason,
  TImportStorePageResponse,
  TImportStoreProductResponse,
  TImportStoreRequest,
} from '@/pipes/import-store/import-store.types';

export type TImportStoreFetchResult =
  | { ok: true; response: TImportStorePageResponse | TImportStoreProductResponse }
  | { ok: false; reason: TImportStoreFailureReason; status?: number; retryAfterSeconds?: number };

export type TImportStoreFetchParams = {
  request: TImportStoreRequest;
  url: URL;
  rateLimitKeys: string[];
  remainingBytes: number | null;
  signal?: AbortSignal;
};

/** What the guarded fetch hands the application: the parsed JSON and what the store said about its size. */
export type TImportStoreJsonResult =
  | { ok: true; json: unknown; bytes: number; total: number | null; totalPages: number | null }
  | { ok: false; reason: TImportStoreFailureReason; status?: number };
