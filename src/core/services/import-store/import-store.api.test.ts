import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportStoreApiService } from './import-store.api';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const PAGE = {
  storeUrl: 'https://shop.example.com',
  request: { kind: 'page', page: 2 },
  remainingBytes: 5000,
} as const;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('ImportStoreApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the store, the read and the budget as JSON to the same-origin route, without caching', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ kind: 'page', products: [], rejected: 0, total: 0, totalPages: 0, bytes: 2 }),
    );
    await ImportStoreApiService.fetchStore(PAGE);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/import-store$/);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    expect(JSON.parse(init.body as string)).toEqual({
      storeUrl: 'https://shop.example.com',
      kind: 'page',
      page: 2,
      remainingBytes: 5000,
    });
  });

  it('reads the page again, so only products the reader accepts come back', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        kind: 'page',
        products: [{ id: 1, name: 'Mug', type: 'simple', price_html: 'x' }, { junk: true }],
        rejected: 1,
        total: 7,
        totalPages: 1,
        bytes: 900,
      }),
    );
    const result = await ImportStoreApiService.fetchStore(PAGE);
    expect(result).toMatchObject({
      ok: true,
      response: { kind: 'page', rejected: 2, total: 7, totalPages: 1, bytes: 900 },
    });
    expect(result.ok && result.response.kind === 'page' && result.response.products).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('price_html');
  });

  it('reads one product, and refuses an answer of the wrong kind or shape', async () => {
    fetchMock.mockResolvedValueOnce(json({ kind: 'product', product: { id: 5524, name: 'Hashrate' }, bytes: 300 }));
    expect(
      await ImportStoreApiService.fetchStore({ ...PAGE, request: { kind: 'product', productId: 5524 } }),
    ).toMatchObject({ ok: true, response: { kind: 'product', product: { id: 5524 }, bytes: 300 } });

    fetchMock.mockResolvedValueOnce(json({ kind: 'page', products: [], bytes: 1 }));
    expect(await ImportStoreApiService.fetchStore({ ...PAGE, request: { kind: 'product', productId: 5524 } })).toEqual({
      ok: false,
      reason: 'not_woocommerce',
    });

    fetchMock.mockResolvedValueOnce(json({ kind: 'page', products: 'nope' }));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toEqual({ ok: false, reason: 'not_woocommerce' });
  });

  it('maps a failure body to its reason, with the Retry-After hint', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ reason: 'rate_limited' }), { status: 429, headers: { 'retry-after': '12' } }),
    );
    expect(await ImportStoreApiService.fetchStore(PAGE)).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 12,
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'dns_failed' }), { status: 502 }));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toMatchObject({ ok: false, reason: 'dns_failed' });
  });

  it('treats a proxy error page, an unknown reason and a dropped connection as network, and an abort as cancelled', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toMatchObject({ ok: false, reason: 'network' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'weird' }), { status: 500 }));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toMatchObject({ ok: false, reason: 'network' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toMatchObject({ ok: false, reason: 'network' });
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    expect(await ImportStoreApiService.fetchStore(PAGE)).toEqual({ ok: false, reason: 'cancelled' });
  });
});
