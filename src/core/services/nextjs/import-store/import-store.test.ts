import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_STORE_FETCH_TIMEOUT_MS,
  IMPORT_STORE_MAX_PAGE_BYTES,
  IMPORT_STORE_MAX_PRODUCT_BYTES,
} from '@/config/import-store';
import { importImageSafeLookup } from '../import-image/import-image';
import { NextJsImportStoreService } from './import-store';

const { mockFetch, mockResolve4, mockResolve6, agentOptions, agentInstances } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  agentOptions: [] as Array<{ connect?: { lookup?: unknown } }>,
  agentInstances: [] as unknown[],
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
  class RecordingAgent {
    constructor(options: { connect?: { lookup?: unknown } }) {
      agentOptions.push(options);
      agentInstances.push(this);
    }
  }
  return { ...actual, fetch: mockFetch, Agent: RecordingAgent };
});

const PUBLIC_IP = '93.184.216.34';
const dnsError = () => Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
const PAGE_URL = 'https://shop.example.com/wp-json/wc/store/v1/products?per_page=100&page=1';
const PRODUCTS = [{ id: 1, name: 'Mug' }];

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  });
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function fetchPage(url = PAGE_URL, remainingBytes: number | null = null, signal?: AbortSignal) {
  return NextJsImportStoreService.fetchJson({
    request: { kind: 'page', page: 1 },
    url: new URL(url),
    remainingBytes,
    signal,
  });
}

function fetchProduct(
  url = 'https://shop.example.com/wp-json/wc/store/v1/products/5524',
  remainingBytes: number | null = null,
) {
  return NextJsImportStoreService.fetchJson({
    request: { kind: 'product', productId: 5524 },
    url: new URL(url),
    remainingBytes,
  });
}

describe('NextJsImportStoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve4.mockResolvedValue([PUBLIC_IP]);
    mockResolve6.mockRejectedValue(dnsError());
  });

  describe('success path', () => {
    it('returns the parsed JSON, its size and the store counts from X-WP-Total and X-WP-TotalPages', async () => {
      const body = JSON.stringify(PRODUCTS);
      mockFetch.mockResolvedValueOnce(jsonResponse(body, { 'x-wp-total': '279', 'x-wp-totalpages': '3' }));
      expect(await fetchPage()).toEqual({
        ok: true,
        json: PRODUCTS,
        bytes: new TextEncoder().encode(body).byteLength,
        total: 279,
        totalPages: 3,
      });
    });

    it('treats a missing or malformed count header as unknown', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(PRODUCTS, { 'x-wp-total': 'many' }));
      expect(await fetchPage()).toMatchObject({ ok: true, total: null, totalPages: null });
    });

    it('accepts application/json and a +json type, and reads UTF-8', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ name: 'Bücher – Ständer' }], { 'content-type': 'application/hal+json' }),
      );
      expect(await fetchPage()).toMatchObject({ ok: true, json: [{ name: 'Bücher – Ständer' }] });
    });

    it('asks for JSON and sends no cookies, credentials, referrer or authorization', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(PRODUCTS));
      await fetchPage();
      const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string> }];
      expect(String(url)).toBe(PAGE_URL);
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('omit');
      expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.redirect).toBe('manual');
      expect(init.headers.Accept).toBe('application/json');
      const names = Object.keys(init.headers).map((name) => name.toLowerCase());
      expect(names).not.toContain('cookie');
      expect(names).not.toContain('authorization');
      expect(names).not.toContain('referer');
    });
  });

  describe('private and special-purpose addresses', () => {
    it.each([
      ['loopback v4', 'https://127.0.0.1/wp-json/wc/store/v1/products'],
      ['10/8', 'https://10.0.0.5/wp-json/wc/store/v1/products'],
      ['192.168/16', 'https://192.168.1.1/wp-json/wc/store/v1/products'],
      ['link-local metadata', 'https://169.254.169.254/wp-json/wc/store/v1/products'],
      ['decimal-encoded loopback', 'https://2130706433/wp-json/wc/store/v1/products'],
      ['loopback v6', 'https://[::1]/wp-json/wc/store/v1/products'],
      ['unique-local v6', 'https://[fd00::1]/wp-json/wc/store/v1/products'],
      ['v4-mapped metadata', 'https://[::ffff:a9fe:a9fe]/wp-json/wc/store/v1/products'],
    ])('refuses %s without opening a connection', async (_name, url) => {
      expect(await fetchPage(url)).toMatchObject({ ok: false, reason: 'blocked_address' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses a hostname that resolves private, including one of several answers', async () => {
      mockResolve4.mockResolvedValue([PUBLIC_IP, '10.1.2.3']);
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'blocked_address' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports an unresolvable host as dns_failed', async () => {
      mockResolve4.mockRejectedValue(dnsError());
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'dns_failed' });
    });

    it('maps a connection-time blocked lookup (DNS rebinding after the preflight) to blocked_address', async () => {
      mockResolve4.mockResolvedValue(['127.0.0.1']);
      const lookupError = await new Promise<Error>((resolve) => {
        importImageSafeLookup(
          'rebind.example.com',
          { all: true } as never,
          ((error: Error) => resolve(error)) as never,
        );
      });
      mockResolve4.mockResolvedValue([PUBLIC_IP]);
      mockFetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: lookupError }));
      expect(await fetchPage('https://rebind.example.com/wp-json/wc/store/v1/products')).toMatchObject({
        ok: false,
        reason: 'blocked_address',
      });
    });
  });

  describe('redirects', () => {
    it('follows a redirect to another public https host, sending every hop through the pinned dispatcher', async () => {
      mockFetch
        .mockResolvedValueOnce(
          redirectTo('https://www.shop.example.com/wp-json/wc/store/v1/products?per_page=100&page=1'),
        )
        .mockResolvedValueOnce(jsonResponse(PRODUCTS));
      expect(await fetchPage()).toMatchObject({ ok: true });
      expect(agentOptions[0]?.connect?.lookup).toBe(importImageSafeLookup);
      const dispatchers = mockFetch.mock.calls.map(([, init]) => (init as { dispatcher: unknown }).dispatcher);
      expect(dispatchers).toHaveLength(2);
      expect(dispatchers.every((dispatcher) => dispatcher === agentInstances[0])).toBe(true);
      expect(mockResolve4.mock.calls.map(([hostname]) => hostname)).toEqual([
        'shop.example.com',
        'www.shop.example.com',
      ]);
    });

    it('refuses a redirect to http, to a private host, or to a host that re-resolves private', async () => {
      mockFetch.mockResolvedValueOnce(redirectTo('http://shop.example.com/wp-json/wc/store/v1/products'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'blocked_address' });

      mockFetch.mockResolvedValueOnce(redirectTo('https://169.254.169.254/latest/meta-data/'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'blocked_address' });

      mockResolve4.mockResolvedValueOnce([PUBLIC_IP]).mockResolvedValueOnce(['10.0.0.9']);
      mockFetch.mockResolvedValueOnce(redirectTo('https://other.example.net/wp-json/wc/store/v1/products'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'blocked_address' });
    });

    it('caps the redirect chain and treats a redirect without Location as an http error', async () => {
      mockFetch.mockImplementation(async () => redirectTo('https://shop.example.com/again'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'too_many_redirects' });
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 302 }));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'http_error', status: 302 });
    });
  });

  describe('size caps', () => {
    it('refuses early when Content-Length exceeds the page cap, and a product cap that is smaller', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(PRODUCTS, { 'content-length': String(IMPORT_STORE_MAX_PAGE_BYTES + 1) }),
      );
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'too_large' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse(PRODUCTS, { 'content-length': String(IMPORT_STORE_MAX_PRODUCT_BYTES + 1) }),
      );
      expect(await fetchProduct()).toMatchObject({ ok: false, reason: 'too_large' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse(PRODUCTS, { 'content-length': String(IMPORT_STORE_MAX_PRODUCT_BYTES + 1) }),
      );
      expect(await fetchPage()).toMatchObject({ ok: true });
    });

    it('stops reading a body that outgrows the cap despite a small Content-Length', async () => {
      const cancel = vi.fn();
      const chunk = new Uint8Array(1024 * 1024).fill(0x20);
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      });
      mockFetch.mockResolvedValueOnce(
        new Response(endless, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': '100' },
        }),
      );
      expect(await fetchProduct()).toMatchObject({ ok: false, reason: 'too_large' });
      expect(cancel).toHaveBeenCalled();
    });

    it('reports budget_exceeded when the remaining import budget is the binding limit, from the header or the body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(PRODUCTS, { 'content-length': '5000' }));
      expect(await fetchPage(PAGE_URL, 4096)).toMatchObject({ ok: false, reason: 'budget_exceeded' });
      mockFetch.mockResolvedValueOnce(jsonResponse(JSON.stringify([{ name: 'x'.repeat(3000) }])));
      expect(await fetchPage(PAGE_URL, 1024)).toMatchObject({ ok: false, reason: 'budget_exceeded' });
    });
  });

  describe('content', () => {
    it('refuses a page that is not JSON: HTML, plain text, no type, with the body released', async () => {
      for (const headers of [
        { 'content-type': 'text/html' },
        { 'content-type': 'text/plain' },
        { 'content-type': '' },
      ]) {
        mockFetch.mockResolvedValueOnce(new Response('<html></html>', { status: 200, headers }));
        expect(await fetchPage()).toMatchObject({ ok: false, reason: 'not_json' });
      }
    });

    it('refuses JSON content type with a body that is not JSON, not UTF-8 or empty', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse('{"half":'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'not_json' });
      mockFetch.mockResolvedValueOnce(
        new Response(new Uint8Array([0x5b, 0xff, 0xfe, 0x5d]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'not_json' });
      mockFetch.mockResolvedValueOnce(
        new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'not_json' });
    });
  });

  describe('failures and timeouts', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('maps a 404 to not_woocommerce and other non-2xx statuses to http_error with the status', async () => {
      mockFetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'not_woocommerce', status: 404 });
      mockFetch.mockResolvedValueOnce(new Response('denied', { status: 403 }));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'http_error', status: 403 });
      mockFetch.mockResolvedValueOnce(new Response('down', { status: 503 }));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'http_error', status: 503 });
    });

    it('maps a connect failure to network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect(await fetchPage()).toMatchObject({ ok: false, reason: 'network' });
    });

    it('times out when the server never answers, and when a body stalls after the headers', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const silent = fetchPage();
      await vi.advanceTimersByTimeAsync(IMPORT_STORE_FETCH_TIMEOUT_MS + 10);
      expect(await silent).toMatchObject({ ok: false, reason: 'timeout' });

      mockFetch.mockReset();
      mockFetch.mockImplementation((_url: URL, init: RequestInit) => {
        const stalled = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[{"id":'));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
          pull: () => new Promise(() => {}),
        });
        return Promise.resolve(new Response(stalled, { status: 200, headers: { 'content-type': 'application/json' } }));
      });
      const slow = fetchPage();
      await vi.advanceTimersByTimeAsync(IMPORT_STORE_FETCH_TIMEOUT_MS + 10);
      expect(await slow).toMatchObject({ ok: false, reason: 'timeout' });
    });

    it('reports cancelled when the caller aborts', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = fetchPage(PAGE_URL, null, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    });
  });
});
