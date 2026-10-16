import { describe, expect, it } from 'vitest';
import { ImportStoreValidators } from './import-store.validators';

const base = (raw: unknown) => {
  const result = ImportStoreValidators.validateStoreUrl(raw);
  return result.ok ? ImportStoreValidators.baseText(result.base) : result.message;
};

describe('ImportStoreValidators.validateStoreUrl', () => {
  it('takes a bare host, an https address or a link into the shop, and keeps only the shop base', () => {
    expect(base('dezentralshop.ch')).toBe('https://dezentralshop.ch');
    expect(base('  https://DezentralShop.ch/  ')).toBe('https://dezentralshop.ch');
    expect(base('https://dezentralshop.ch/product/avalon-mini-3/?utm=1#reviews')).toBe('https://dezentralshop.ch');
    expect(base('https://example.com/shop/')).toBe('https://example.com');
    expect(base('https://example.com/shop/wp-json/wc/store/v1/products?page=2')).toBe('https://example.com/shop');
    expect(base('https://example.com/wp-json')).toBe('https://example.com');
  });

  it('refuses anything but https on the default port, credentials, local names and unsupported paths', () => {
    expect(base('http://example.com')).toBe('Only https image URLs are allowed.');
    expect(base('ftp://example.com')).toBe('Only https store addresses are allowed.');
    expect(base('javascript:alert(1)')).toBe('Only https store addresses are allowed.');
    expect(base('https://user:pass@example.com')).toBe('URLs with credentials are not allowed.');
    expect(base('https://example.com:8443')).toBe('Only the default https port is allowed.');
    expect(base('https://localhost')).toBe('This hostname is not allowed.');
    expect(base('https://printer.local')).toBe('This hostname is not allowed.');
    expect(base('https://example.com/a b/wp-json')).toBe('Unsupported store address.');
    expect(base('https://example.com/a/b/c/d/e/wp-json')).toBe('Unsupported store address.');
    expect(base('')).toBe('Invalid URL');
    expect(base(42)).toBe('Invalid URL');
    expect(base(`https://example.com/${'a'.repeat(3000)}`)).toBe('Invalid URL');
  });
});

describe('ImportStoreValidators URL building', () => {
  const store = ImportStoreValidators.validateStoreUrl('https://example.com/shop/wp-json');
  if (!store.ok) throw new Error('fixture');

  it('builds only the fixed catalogue path under the base, with a number as the only variable part', () => {
    expect(ImportStoreValidators.pageUrl(store.base, 3).href).toBe(
      'https://example.com/shop/wp-json/wc/store/v1/products?per_page=100&page=3',
    );
    expect(ImportStoreValidators.productUrl(store.base, 5524).href).toBe(
      'https://example.com/shop/wp-json/wc/store/v1/products/5524',
    );
  });
});

describe('ImportStoreValidators.validateRequest', () => {
  const valid = (body: unknown) => {
    const result = ImportStoreValidators.validateRequest(body, 50);
    return result.ok ? { request: result.request, url: result.url.href } : result.message;
  };

  it('accepts a page or a product read and builds its URL', () => {
    expect(valid({ storeUrl: 'example.com', kind: 'page', page: 2 })).toEqual({
      request: { kind: 'page', page: 2 },
      url: 'https://example.com/wp-json/wc/store/v1/products?per_page=100&page=2',
    });
    expect(valid({ storeUrl: 'example.com', kind: 'product', productId: 12 })).toEqual({
      request: { kind: 'product', productId: 12 },
      url: 'https://example.com/wp-json/wc/store/v1/products/12',
    });
  });

  it('refuses a page or product that is not a plain positive integer in range, and any other kind', () => {
    for (const page of [0, -1, 51, 1.5, '2', null, Number.NaN]) {
      expect(valid({ storeUrl: 'example.com', kind: 'page', page })).toBe('Invalid page');
    }
    for (const productId of [0, -3, 2 ** 31 + 1, 2.5, '7', '../../etc', null]) {
      expect(valid({ storeUrl: 'example.com', kind: 'product', productId })).toBe('Invalid product');
    }
    expect(valid({ storeUrl: 'example.com', kind: 'path', path: '/wp-json/wp/v2/users' })).toBe('Invalid request');
    expect(valid({ storeUrl: 'http://example.com', kind: 'page', page: 1 })).toBe('Only https image URLs are allowed.');
    expect(valid(null)).toBe('Invalid request');
    expect(valid([])).toBe('Invalid request');
  });

  it('clamps the reported remaining budget like the image route', () => {
    expect(ImportStoreValidators.parseRemainingBytes(1234.9)).toBe(1234);
    expect(ImportStoreValidators.parseRemainingBytes(-1)).toBeNull();
    expect(ImportStoreValidators.parseRemainingBytes('5')).toBeNull();
  });
});
