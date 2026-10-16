import {
  IMPORT_STORE_MAX_PAGES,
  IMPORT_STORE_MAX_PRODUCTS,
  IMPORT_STORE_MAX_RETRY_WAIT_SECONDS,
  IMPORT_STORE_MAX_TOTAL_BYTES,
  IMPORT_STORE_MAX_VARIATION_READS,
  IMPORT_STORE_PER_PAGE,
  IMPORT_STORE_VARIATION_CONCURRENCY,
} from '@/config/import-store';
import type { WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import {
  IMPORT_STORE_FAILURE_COPY,
  type TImportStoreFailureReason,
  type TImportStorePageResponse,
  type TImportStoreProductResponse,
  type TImportStoreRequest,
} from '@/pipes/import-store/import-store.types';
import { ImportStoreValidators } from '@/pipes/import-store/import-store.validators';
import { ImportStoreApiService } from '@/services/import-store/import-store.api';

export type TImportStoreProgress = { phase: 'pages' | 'variations'; done: number; total: number };

export type TImportStoreCatalogParams = {
  /** What the seller pasted: a host or an https address. */
  storeUrl: string;
  signal?: AbortSignal;
  onProgress?: (progress: TImportStoreProgress) => void;
};

export type TImportStoreCatalogResult =
  | { ok: true; catalog: WooStoreCatalog }
  | { ok: false; reason: TImportStoreFailureReason | 'empty'; message: string };

const EMPTY_STORE_COPY = 'This store has no public products to import.';
const MAX_RATE_LIMIT_WAITS = 3;

type TStoreResponse = TImportStorePageResponse | TImportStoreProductResponse;
type TCallResult = { ok: true; response: TStoreResponse } | { ok: false; reason: TImportStoreFailureReason };
type TPageCall = { ok: true; page: TImportStorePageResponse } | { ok: false; reason: TImportStoreFailureReason };
type TProductCall = { ok: true; product: StoreApiProduct } | { ok: false; reason: TImportStoreFailureReason };

/**
 * Browser half of the store import: reads the whole public catalogue through
 * the server route, a page at a time, then each variation of a variable
 * product. A page that cannot be read ends the import (a half catalogue is not
 * a catalogue); a variation that cannot be read is left out and reported by
 * the mapper. Honours the route's rate limit by waiting out a short
 * `Retry-After`, and keeps the whole run inside the per-import byte budget.
 */
export class ImportStoreCatalogApplication {
  private constructor() {}

  static async fetchCatalog({
    storeUrl,
    signal,
    onProgress,
  }: TImportStoreCatalogParams): Promise<TImportStoreCatalogResult> {
    const validation = ImportStoreValidators.validateStoreUrl(storeUrl);
    if (!validation.ok) return failed('invalid_url');
    const base = ImportStoreValidators.baseText(validation.base);

    let usedBytes = 0;
    const call = async (request: TImportStoreRequest): Promise<TCallResult> => {
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) return { ok: false, reason: 'cancelled' };
        const remainingBytes = IMPORT_STORE_MAX_TOTAL_BYTES - usedBytes;
        if (remainingBytes <= 0) return { ok: false, reason: 'budget_exceeded' };

        const result = await ImportStoreApiService.fetchStore({ storeUrl: base, request, remainingBytes, signal });
        if (result.ok) {
          usedBytes += result.response.bytes;
          return result;
        }
        const wait = result.retryAfterSeconds;
        if (
          result.reason === 'rate_limited' &&
          wait !== undefined &&
          wait <= IMPORT_STORE_MAX_RETRY_WAIT_SECONDS &&
          attempt < MAX_RATE_LIMIT_WAITS
        ) {
          if (!(await sleep(wait * 1000, signal))) return { ok: false, reason: 'cancelled' };
          continue;
        }
        return { ok: false, reason: result.reason };
      }
    };

    const callPage = async (page: number): Promise<TPageCall> => {
      const result = await call({ kind: 'page', page });
      if (!result.ok) return result;
      return result.response.kind === 'page'
        ? { ok: true, page: result.response }
        : { ok: false, reason: 'not_woocommerce' };
    };
    const callProduct = async (productId: number): Promise<TProductCall> => {
      const result = await call({ kind: 'product', productId });
      if (!result.ok) return result;
      return result.response.kind === 'product'
        ? { ok: true, product: result.response.product }
        : { ok: false, reason: 'not_woocommerce' };
    };

    const first = await callPage(1);
    if (!first.ok) return failed(first.reason);
    const firstPage = first.page;

    const products: StoreApiProduct[] = [...firstPage.products];
    let rejected = firstPage.rejected;
    const total = firstPage.total;
    const pageCount = Math.min(
      firstPage.totalPages ?? (firstPage.products.length >= IMPORT_STORE_PER_PAGE ? IMPORT_STORE_MAX_PAGES : 1),
      IMPORT_STORE_MAX_PAGES,
    );
    onProgress?.({ phase: 'pages', done: 1, total: pageCount });

    for (let page = 2; page <= pageCount; page += 1) {
      if (products.length + rejected >= IMPORT_STORE_MAX_PRODUCTS) break;
      const next = await callPage(page);
      if (!next.ok) return failed(next.reason);
      const read = next.page;
      products.push(...read.products);
      rejected += read.rejected;
      onProgress?.({ phase: 'pages', done: page, total: pageCount });
      if (read.products.length + read.rejected === 0) break;
    }

    const unique = new Map<number, StoreApiProduct>();
    for (const product of products) if (!unique.has(product.id)) unique.set(product.id, product);
    const catalogProducts = [...unique.values()].slice(0, IMPORT_STORE_MAX_PRODUCTS);
    if (catalogProducts.length === 0 && rejected === 0)
      return { ok: false, reason: 'empty', message: EMPTY_STORE_COPY };

    const variations = await readVariations(catalogProducts, callProduct, onProgress);
    if (signal?.aborted) return failed('cancelled');

    return {
      ok: true,
      catalog: { storeUrl: base, products: catalogProducts, variations, unreadProducts: rejected, total },
    };
  }
}

async function readVariations(
  products: readonly StoreApiProduct[],
  callProduct: (productId: number) => Promise<TProductCall>,
  onProgress: TImportStoreCatalogParams['onProgress'],
): Promise<Record<string, StoreApiProduct[]>> {
  const wanted: { parent: number; id: number }[] = [];
  for (const product of products) {
    if (product.type !== 'variable') continue;
    for (const ref of product.variations) wanted.push({ parent: product.id, id: ref.id });
  }
  const toRead = wanted.slice(0, IMPORT_STORE_MAX_VARIATION_READS);
  const reads = new Map<number, StoreApiProduct>();
  let done = 0;
  let cursor = 0;
  let stop = false;
  onProgress?.({ phase: 'variations', done, total: toRead.length });

  const worker = async () => {
    while (!stop) {
      const index = cursor;
      cursor += 1;
      const target = toRead[index];
      if (!target) return;
      const result = await callProduct(target.id);
      done += 1;
      if (result.ok && result.product.id === target.id) {
        reads.set(target.id, result.product);
      } else if (!result.ok && (result.reason === 'cancelled' || result.reason === 'budget_exceeded')) {
        stop = true;
      }
      onProgress?.({ phase: 'variations', done, total: toRead.length });
    }
  };
  await Promise.all(Array.from({ length: IMPORT_STORE_VARIATION_CONCURRENCY }, worker));

  const grouped: Record<string, StoreApiProduct[]> = {};
  for (const product of products) {
    if (product.type !== 'variable') continue;
    grouped[String(product.id)] = product.variations.flatMap((ref) => {
      const read = reads.get(ref.id);
      return read ? [read] : [];
    });
  }
  return grouped;
}

function failed(reason: TImportStoreFailureReason): TImportStoreCatalogResult {
  return { ok: false, reason, message: IMPORT_STORE_FAILURE_COPY[reason] };
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
