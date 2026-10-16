import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS, IMPORT_STORE_RATE_LIMIT_REQUESTS } from '@/config/import-store';
import { NextJsImportStoreService } from '@/services/nextjs/import-store/import-store';
import { ImportStoreRateLimiter } from '@/services/nextjs/import-store/import-store.rate-limit';
import { ImportStoreApplication } from './import-store';
import type { TImportStoreFetchParams } from './import-store.types';

const url = new URL('https://shop.example.com/wp-json/wc/store/v1/products?per_page=100&page=1');
const page = (keys: string[] = ['ip:1']): TImportStoreFetchParams => ({
  request: { kind: 'page', page: 1 },
  url,
  rateLimitKeys: keys,
  remainingBytes: null,
});
const product: TImportStoreFetchParams = {
  request: { kind: 'product', productId: 5524 },
  url: new URL('https://shop.example.com/wp-json/wc/store/v1/products/5524'),
  rateLimitKeys: ['ip:1'],
  remainingBytes: 9_999,
};

describe('ImportStoreApplication', () => {
  const serviceSpy = vi.spyOn(NextJsImportStoreService, 'fetchJson');

  beforeEach(() => {
    vi.clearAllMocks();
    ImportStoreRateLimiter.resetForTests();
    serviceSpy.mockResolvedValue({
      ok: true,
      json: [{ id: 1, name: 'Mug', price_html: '<b>big markup</b>', extensions: { a: 1 } }, { nope: true }],
      bytes: 2048,
      total: 2,
      totalPages: 1,
    });
  });

  it('returns a page trimmed to the fields the import reads, counting entries it could not read', async () => {
    const result = await ImportStoreApplication.fetch(page());
    expect(result).toEqual({
      ok: true,
      response: {
        kind: 'page',
        products: [expect.objectContaining({ id: 1, name: 'Mug', is_in_stock: false })],
        rejected: 1,
        total: 2,
        totalPages: 1,
        bytes: 2048,
      },
    });
    expect(JSON.stringify(result)).not.toContain('big markup');
    expect(JSON.stringify(result)).not.toContain('extensions');
  });

  it('returns one product read, trimmed, and passes the budget to the fetch', async () => {
    serviceSpy.mockResolvedValueOnce({
      ok: true,
      json: { id: 5524, name: 'Hashrate 110', type: 'variation', parent: 5398 },
      bytes: 700,
      total: null,
      totalPages: null,
    });
    const result = await ImportStoreApplication.fetch(product);
    expect(result).toMatchObject({
      ok: true,
      response: { kind: 'product', bytes: 700, product: { id: 5524, parent: 5398 } },
    });
    expect(serviceSpy).toHaveBeenCalledWith(expect.objectContaining({ remainingBytes: 9_999 }));
  });

  it('says not_woocommerce for JSON that is not a product list or a product', async () => {
    serviceSpy.mockResolvedValueOnce({
      ok: true,
      json: { code: 'rest_no_route' },
      bytes: 40,
      total: null,
      totalPages: null,
    });
    expect(await ImportStoreApplication.fetch(page())).toEqual({ ok: false, reason: 'not_woocommerce' });
    serviceSpy.mockResolvedValueOnce({ ok: true, json: [], bytes: 2, total: null, totalPages: null });
    expect(await ImportStoreApplication.fetch(product)).toEqual({ ok: false, reason: 'not_woocommerce' });
  });

  it('passes a fetch failure through and does not charge bytes for it', async () => {
    const recordSpy = vi.spyOn(ImportStoreRateLimiter, 'recordBytes');
    serviceSpy.mockResolvedValueOnce({ ok: false, reason: 'http_error', status: 503 });
    expect(await ImportStoreApplication.fetch(page())).toEqual({ ok: false, reason: 'http_error', status: 503 });
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('charges the bytes read to every key and to the global allowance', async () => {
    const recordSpy = vi.spyOn(ImportStoreRateLimiter, 'recordBytes');
    const globalSpy = vi.spyOn(ImportStoreRateLimiter, 'recordGlobalBytes');
    await ImportStoreApplication.fetch(page(['ip:1', 'session:a']));
    expect(recordSpy).toHaveBeenCalledWith('ip:1', 2048);
    expect(recordSpy).toHaveBeenCalledWith('session:a', 2048);
    expect(globalSpy).toHaveBeenCalledWith(2048);
  });

  it('answers rate_limited with a retry hint and skips the fetch once a key is exhausted', async () => {
    for (let i = 0; i < IMPORT_STORE_RATE_LIMIT_REQUESTS; i += 1)
      await ImportStoreApplication.fetch(page(['session:a']));
    serviceSpy.mockClear();
    const result = await ImportStoreApplication.fetch(page(['session:a']));
    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(result.ok === false && result.retryAfterSeconds).toBeGreaterThan(0);
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('enforces every key: an exhausted IP bucket blocks a fresh session', async () => {
    for (let i = 0; i < IMPORT_STORE_RATE_LIMIT_REQUESTS; i += 1) await ImportStoreApplication.fetch(page(['ip:1']));
    expect(await ImportStoreApplication.fetch(page(['ip:1', 'session:fresh']))).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('refuses all callers, with fresh identities, once the global request allowance is spent', async () => {
    for (let i = 0; i < IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS; i += 1) {
      await ImportStoreApplication.fetch(page([`session:${i}`]));
    }
    serviceSpy.mockClear();
    expect(await ImportStoreApplication.fetch(page(['session:brand-new']))).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
    expect(serviceSpy).not.toHaveBeenCalled();
  });
});
