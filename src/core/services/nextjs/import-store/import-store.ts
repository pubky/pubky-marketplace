import type { TImportStoreJsonResult } from '@/application/import-store/import-store.types';
import {
  IMPORT_STORE_FETCH_TIMEOUT_MS,
  IMPORT_STORE_MAX_PAGE_BYTES,
  IMPORT_STORE_MAX_PRODUCT_BYTES,
} from '@/config/import-store';
import { Logger } from '@/libs/logger/logger';
import type { TImportStoreFailureReason, TImportStoreRequest } from '@/pipes/import-store/import-store.types';
import { classifyError, followRedirects } from '../import-image/import-image';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PubkyShopImportStoreFetcher/1.0)',
  Accept: 'application/json',
};

export type TNextJsImportStoreFetchParams = {
  request: TImportStoreRequest;
  url: URL;
  /** Bytes still available in the caller's import budget; null when unknown. */
  remainingBytes: number | null;
  signal?: AbortSignal;
};

/**
 * Fetches one public WooCommerce Store API response for a seller's import.
 *
 * The guards are the image route's: https only; DNS preflight and
 * connection-time pinning on every hop (`followRedirects`); manual redirects
 * capped and re-validated; no cookies, credentials or referrer; one wall-clock
 * timeout over headers and body; a streamed byte cap per response and the
 * caller's remaining import budget; JSON content type only. Expected failures
 * return as data.
 */
export class NextJsImportStoreService {
  private constructor() {}

  static async fetchJson({
    request,
    url,
    remainingBytes,
    signal,
  }: TNextJsImportStoreFetchParams): Promise<TImportStoreJsonResult> {
    const perResponse = request.kind === 'page' ? IMPORT_STORE_MAX_PAGE_BYTES : IMPORT_STORE_MAX_PRODUCT_BYTES;
    const budgetBound = remainingBytes !== null && remainingBytes < perResponse;
    const maxBytes = budgetBound ? remainingBytes : perResponse;
    const overLimitReason: TImportStoreFailureReason = budgetBound ? 'budget_exceeded' : 'too_large';

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IMPORT_STORE_FETCH_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const hop = await followRedirects(url, controller.signal, FETCH_HEADERS);
      if (!hop.ok) return failure(storeReason(hop.reason), url, hop.status);

      const response = hop.value;
      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response);
        return failure(response.status === 404 ? 'not_woocommerce' : 'http_error', url, response.status);
      }

      if (!isJsonType(response.headers.get('content-type'))) {
        await cancelBody(response);
        return failure('not_json', url);
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await cancelBody(response);
        return failure(overLimitReason, url);
      }

      const body = await readCapped(response, maxBytes);
      if (!body.ok) return failure(body.reason === 'too_large' ? overLimitReason : body.reason, url);

      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
      } catch {
        return failure('not_json', url);
      }
      return {
        ok: true,
        json,
        bytes: body.bytes.byteLength,
        total: headerCount(response.headers.get('x-wp-total')),
        totalPages: headerCount(response.headers.get('x-wp-totalpages')),
      };
    } catch (error) {
      return failure(storeReason(classifyError(error, timedOut)), url);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

/** The transport's reasons that mean the same for a store; anything else is a plain network failure. */
function storeReason(reason: string): TImportStoreFailureReason {
  switch (reason) {
    case 'invalid_url':
    case 'blocked_address':
    case 'dns_failed':
    case 'too_many_redirects':
    case 'http_error':
    case 'timeout':
    case 'cancelled':
      return reason;
    default:
      return 'network';
  }
}

function isJsonType(header: string | null): boolean {
  const type = header?.split(';')[0].trim().toLowerCase() ?? '';
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'));
}

function headerCount(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) return null;
  return Number(value.trim());
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'not_json' }> {
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, reason: 'not_json' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return total === 0 ? { ok: false, reason: 'not_json' } : { ok: true, bytes };
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function failure(reason: TImportStoreFailureReason, url: URL, status?: number): TImportStoreJsonResult {
  Logger.warn('[import-store:fetch]', { outcome: 'failed', reason, hostname: url.hostname, status });
  return { ok: false, reason, status };
}
