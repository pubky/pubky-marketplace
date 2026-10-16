import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_STORE_MAX_PAGES, IMPORT_STORE_MAX_TOTAL_BYTES } from '@/config/import-store';
import { mapWooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import type { TImportStoreRequest } from '@/pipes/import-store/import-store.types';
import { ImportStoreApiService, type TImportStoreApiResult } from '@/services/import-store/import-store.api';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { ImportStoreCatalogApplication, type TImportStoreProgress } from './import-store-catalog';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce/store-api');
const PAGES = [1, 2, 3].map(
  (page) =>
    JSON.parse(readFileSync(resolve(FIXTURES, `dezentralshop-products-p${page}.json`), 'utf8')) as StoreApiProduct[],
);
const VARIATIONS = JSON.parse(readFileSync(resolve(FIXTURES, 'dezentralshop-variations.json'), 'utf8')) as Record<
  string,
  StoreApiProduct
>;

/** The three recorded pages and the recorded variation reads, answered the way the route would. */
function recordedStore(request: TImportStoreRequest): TImportStoreApiResult {
  if (request.kind === 'page') {
    const products = PAGES[request.page - 1];
    if (!products) return { ok: false, reason: 'http_error' };
    return { ok: true, response: { kind: 'page', products, rejected: 0, total: 279, totalPages: 3, bytes: 1000 } };
  }
  const product = VARIATIONS[String(request.productId)];
  return product
    ? { ok: true, response: { kind: 'product', product, bytes: 100 } }
    : { ok: false, reason: 'not_woocommerce' };
}

describe('ImportStoreCatalogApplication', () => {
  const apiSpy = vi.spyOn(ImportStoreApiService, 'fetchStore');

  beforeEach(() => {
    vi.clearAllMocks();
    apiSpy.mockImplementation(async ({ request }) => recordedStore(request));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads all three pages and every variation of the recorded Dezentralshop catalogue, with no network', async () => {
    const progress: TImportStoreProgress[] = [];
    const result = await ImportStoreCatalogApplication.fetchCatalog({
      storeUrl: 'https://Dezentralshop.ch/wp-json/wc/store/v1/products?page=2',
      onProgress: (entry) => progress.push(entry),
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.catalog).toMatchObject({ storeUrl: 'https://dezentralshop.ch', unreadProducts: 0, total: 279 });
    expect(result.catalog.products).toHaveLength(279);
    expect(Object.keys(result.catalog.variations)).toHaveLength(10);
    expect(Object.values(result.catalog.variations).flat()).toHaveLength(30);
    expect(
      apiSpy.mock.calls.filter(([params]) => params.request.kind === 'page').map(([params]) => params.request),
    ).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'page', page: 2 },
      { kind: 'page', page: 3 },
    ]);
    expect(apiSpy.mock.calls.every(([params]) => params.storeUrl === 'https://dezentralshop.ch')).toBe(true);
    expect(progress.filter((entry) => entry.phase === 'pages').at(-1)).toEqual({ phase: 'pages', done: 3, total: 3 });
    expect(progress.at(-1)).toEqual({ phase: 'variations', done: 30, total: 30 });
  });

  it('feeds the mapper: the fetched catalogue imports as the same 279 listings and 299 variants', async () => {
    const result = await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    if (!result.ok) throw new Error(result.message);
    const mapped = mapWooStoreCatalog({
      catalog: result.catalog,
      sellerPubky: 'y'.repeat(52),
      settings: { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' },
      offeredCurrencies: ['USD', 'CHF'],
    });
    expect(mapped.ok && mapped.report).toMatchObject({ listingsRead: 279, listingsImported: 279, listingsSkipped: 0 });
    expect(mapped.ok && mapped.rows).toHaveLength(299);
  });

  it('keeps the variations of a variable product in the order the product lists them', async () => {
    const result = await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.variations['5398']?.map((variation) => variation.id)).toEqual([5524, 5525, 5526]);
  });

  it('sends the remaining byte budget with every read and counts what the store sent', async () => {
    await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    const budgets = apiSpy.mock.calls.map(([params]) => params.remainingBytes);
    expect(budgets[0]).toBe(IMPORT_STORE_MAX_TOTAL_BYTES);
    expect(budgets[1]).toBe(IMPORT_STORE_MAX_TOTAL_BYTES - 1000);
    expect(budgets[3]).toBe(IMPORT_STORE_MAX_TOTAL_BYTES - 3000);
  });

  it('refuses an address that is not a store address without any request', async () => {
    for (const storeUrl of ['', 'http://shop.example.com', 'https://localhost', 'ftp://x.example.com']) {
      expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl })).toMatchObject({
        ok: false,
        reason: 'invalid_url',
      });
    }
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('ends the import, with the reason in plain words, when the first page cannot be read', async () => {
    apiSpy.mockResolvedValueOnce({ ok: false, reason: 'not_woocommerce' });
    expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'example.com' })).toEqual({
      ok: false,
      reason: 'not_woocommerce',
      message: 'That does not look like a WooCommerce store, or its public product list is switched off.',
    });
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });

  it('ends the import when a later page fails, instead of importing a half catalogue', async () => {
    apiSpy.mockImplementation(async ({ request }) =>
      request.kind === 'page' && request.page === 2 ? { ok: false, reason: 'timeout' } : recordedStore(request),
    );
    expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' })).toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });

  it('leaves out a variation that cannot be read, or that answers as another product, and carries on', async () => {
    apiSpy.mockImplementation(async ({ request }) => {
      if (request.kind === 'product' && request.productId === 5525) return { ok: false, reason: 'http_error' };
      if (request.kind === 'product' && request.productId === 5526) {
        return { ok: true, response: { kind: 'product', product: VARIATIONS['5524']!, bytes: 10 } };
      }
      return recordedStore(request);
    });
    const result = await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.variations['5398']?.map((variation) => variation.id)).toEqual([5524]);
    const mapped = mapWooStoreCatalog({
      catalog: result.catalog,
      sellerPubky: 'y'.repeat(52),
      settings: { ...IMPORT_SETTINGS_COMPLETE, currency: 'CHF', countryCode: 'CH' },
      offeredCurrencies: ['CHF'],
    });
    expect(mapped.ok && mapped.report.losses.find((loss) => loss.code === 'variation_unread')).toMatchObject({
      severity: 'dropped',
      count: 2,
    });
  });

  it('counts products the store sent that could not be read', async () => {
    apiSpy.mockImplementation(async ({ request }) => {
      const result = recordedStore(request);
      return result.ok && result.response.kind === 'page'
        ? { ok: true, response: { ...result.response, rejected: 2 } }
        : result;
    });
    const result = await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    expect(result.ok && result.catalog.unreadProducts).toBe(6);
  });

  it('stops at the page cap, and keeps the store count so the mapper can report the rest', async () => {
    apiSpy.mockImplementation(async ({ request }) => {
      if (request.kind !== 'page') return recordedStore(request);
      const id = request.page * 1000;
      const product = { ...PAGES[2]![0]!, id, name: `Page ${request.page}`, type: 'simple', variations: [] };
      return {
        ok: true,
        response: { kind: 'page', products: [product], rejected: 0, total: 9000, totalPages: 90, bytes: 10 },
      };
    });
    const result = await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    if (!result.ok) throw new Error(result.message);
    expect(apiSpy).toHaveBeenCalledTimes(IMPORT_STORE_MAX_PAGES);
    expect(result.catalog.products).toHaveLength(IMPORT_STORE_MAX_PAGES);
    expect(result.catalog.total).toBe(9000);
  });

  it('stops reading when the store byte budget is spent', async () => {
    apiSpy.mockImplementation(async ({ request }) => {
      const result = recordedStore(request);
      return result.ok && result.response.kind === 'page'
        ? { ok: true, response: { ...result.response, bytes: IMPORT_STORE_MAX_TOTAL_BYTES } }
        : result;
    });
    expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' })).toMatchObject({
      ok: false,
      reason: 'budget_exceeded',
    });
  });

  it('says so when a store has no public products', async () => {
    apiSpy.mockResolvedValueOnce({
      ok: true,
      response: { kind: 'page', products: [], rejected: 0, total: 0, totalPages: 0, bytes: 2 },
    });
    expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' })).toEqual({
      ok: false,
      reason: 'empty',
      message: 'This store has no public products to import.',
    });
  });

  it('waits out a short rate-limit answer and retries, and gives up on a long one', async () => {
    vi.useFakeTimers();
    let limited = 1;
    apiSpy.mockImplementation(async ({ request }) => {
      if (limited > 0 && request.kind === 'page' && request.page === 2) {
        limited -= 1;
        return { ok: false, reason: 'rate_limited', retryAfterSeconds: 5 };
      }
      return recordedStore(request);
    });
    const pending = ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(result.ok && result.catalog.products).toHaveLength(279);
    expect(
      apiSpy.mock.calls.filter(([params]) => params.request.kind === 'page' && params.request.page === 2),
    ).toHaveLength(2);

    apiSpy.mockReset();
    apiSpy.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfterSeconds: 600 });
    expect(await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch' })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('stops at once when the caller cancels, during a wait or between reads', async () => {
    const controller = new AbortController();
    apiSpy.mockImplementation(async ({ request }) => {
      if (request.kind === 'page' && request.page === 2) controller.abort();
      return recordedStore(request);
    });
    expect(
      await ImportStoreCatalogApplication.fetchCatalog({ storeUrl: 'dezentralshop.ch', signal: controller.signal }),
    ).toMatchObject({ ok: false, reason: 'cancelled' });

    vi.useFakeTimers();
    const waiting = new AbortController();
    apiSpy.mockReset();
    apiSpy.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfterSeconds: 30 });
    const pending = ImportStoreCatalogApplication.fetchCatalog({
      storeUrl: 'dezentralshop.ch',
      signal: waiting.signal,
    });
    await vi.advanceTimersByTimeAsync(100);
    waiting.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
  });
});
