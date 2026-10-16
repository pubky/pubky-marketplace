import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportStoreApplication } from '@/application/import-store/import-store';
import { ImportStoreController } from './import-store';

describe('ImportStoreController', () => {
  const applicationSpy = vi.spyOn(ImportStoreApplication, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    applicationSpy.mockResolvedValue({
      ok: true,
      response: { kind: 'page', products: [], rejected: 0, total: 0, totalPages: 0, bytes: 2 },
    });
  });

  it.each([
    ['http', { storeUrl: 'http://shop.example.com', kind: 'page', page: 1 }],
    ['credentials', { storeUrl: 'https://u:p@shop.example.com', kind: 'page', page: 1 }],
    ['private host', { storeUrl: 'https://localhost', kind: 'page', page: 1 }],
    ['page 0', { storeUrl: 'shop.example.com', kind: 'page', page: 0 }],
    ['page past the cap', { storeUrl: 'shop.example.com', kind: 'page', page: 51 }],
    ['an arbitrary kind', { storeUrl: 'shop.example.com', kind: 'path', path: '/wp-json/wp/v2/users' }],
    ['no body', undefined],
  ])('rejects a request with %s before any fetch', async (_name, body) => {
    expect(await ImportStoreController.fetch({ body, rateLimitKeys: ['ip:1'] })).toEqual({
      ok: false,
      reason: 'invalid_url',
    });
    expect(applicationSpy).not.toHaveBeenCalled();
  });

  it('builds the only URL it may fetch, from the base the seller gave, and sanitises the budget', async () => {
    await ImportStoreController.fetch({
      body: {
        storeUrl: 'https://shop.example.com/shop/wp-json/wp/v2/users?x=1',
        kind: 'page',
        page: 2,
        remainingBytes: 'lots',
      },
      rateLimitKeys: ['ip:1'],
    });
    expect(applicationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { kind: 'page', page: 2 },
        url: new URL('https://shop.example.com/shop/wp-json/wc/store/v1/products?per_page=100&page=2'),
        remainingBytes: null,
      }),
    );
    await ImportStoreController.fetch({
      body: { storeUrl: 'shop.example.com', kind: 'product', productId: 12, remainingBytes: 4096.7 },
      rateLimitKeys: ['ip:1'],
    });
    expect(applicationSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: { kind: 'product', productId: 12 },
        url: new URL('https://shop.example.com/wp-json/wc/store/v1/products/12'),
        remainingBytes: 4096,
      }),
    );
  });
});
