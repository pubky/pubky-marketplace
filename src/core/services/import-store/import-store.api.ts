import { withBasePath } from '@/config/base-path';
import { IMPORT_STORE_PER_PAGE } from '@/config/import-store';
import { readStoreApiPage, readStoreApiProduct } from '@/pipes/import-store/import-store.product';
import {
  isImportStoreFailureReason,
  type TImportStoreFailureReason,
  type TImportStorePageResponse,
  type TImportStoreProductResponse,
  type TImportStoreRequest,
} from '@/pipes/import-store/import-store.types';

export type TImportStoreApiResult =
  | { ok: true; response: TImportStorePageResponse | TImportStoreProductResponse }
  | { ok: false; reason: TImportStoreFailureReason; retryAfterSeconds?: number };

export type TImportStoreApiParams = {
  /** The store's base address, as the validator normalised it. */
  storeUrl: string;
  request: TImportStoreRequest;
  remainingBytes: number;
  signal?: AbortSignal;
};

const ROUTE = '/api/import-store';

/** Browser client for the import-store route. Same-origin only. */
export class ImportStoreApiService {
  private constructor() {}

  static async fetchStore({
    storeUrl,
    request,
    remainingBytes,
    signal,
  }: TImportStoreApiParams): Promise<TImportStoreApiResult> {
    let response: Response;
    try {
      response = await fetch(withBasePath(ROUTE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeUrl, ...request, remainingBytes }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal?.aborted || (error as { name?: unknown } | null)?.name === 'AbortError') {
        return { ok: false, reason: 'cancelled' };
      }
      return { ok: false, reason: 'network' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: signal?.aborted ? 'cancelled' : 'network' };
    }

    if (!response.ok) {
      const reason = (body as { reason?: unknown } | null)?.reason;
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        reason: isImportStoreFailureReason(reason) ? reason : 'network',
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      };
    }
    return readResponse(request, body);
  }
}

/** The route's answer is trimmed already; it is read again here so the mapper only ever sees what the reader returns. */
function readResponse(request: TImportStoreRequest, body: unknown): TImportStoreApiResult {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const bytes =
    typeof record.bytes === 'number' && Number.isFinite(record.bytes) && record.bytes >= 0 ? record.bytes : 0;

  if (request.kind === 'page') {
    const page = readStoreApiPage(record.products, IMPORT_STORE_PER_PAGE);
    if (record.kind !== 'page' || !page.ok) return { ok: false, reason: 'not_woocommerce' };
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return {
      ok: true,
      response: {
        kind: 'page',
        products: page.products,
        rejected: page.rejected + (count(record.rejected) ?? 0),
        total: count(record.total),
        totalPages: count(record.totalPages),
        bytes,
      },
    };
  }

  const product = readStoreApiProduct(record.product);
  if (record.kind !== 'product' || !product) return { ok: false, reason: 'not_woocommerce' };
  return { ok: true, response: { kind: 'product', product, bytes } };
}
