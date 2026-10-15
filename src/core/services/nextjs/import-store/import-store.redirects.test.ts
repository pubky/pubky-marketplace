import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextJsImportStoreService } from './import-store';

const { mockFetch, mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock('dns/promises', () => ({
  default: { resolve4: mockResolve4, resolve6: mockResolve6 },
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  class StubAgent {}
  return { ...actual, fetch: mockFetch, Agent: StubAgent };
});

// The store's own redirect cap, set apart from the image route's (3), to show the store route follows its own.
vi.mock('@/config/import-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/import-store')>()),
  IMPORT_STORE_MAX_REDIRECTS: 1,
}));

describe('NextJsImportStoreService redirect cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve4.mockResolvedValue(['93.184.216.34']);
    mockResolve6.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  });

  it("follows the store config's redirect cap, not the image route's", async () => {
    mockFetch.mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: 'https://shop.example.com/again' } }),
    );
    const result = await NextJsImportStoreService.fetchJson({
      request: { kind: 'page', page: 1 },
      url: new URL('https://shop.example.com/wp-json/wc/store/v1/products?per_page=100&page=1'),
      remainingBytes: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'too_many_redirects' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
