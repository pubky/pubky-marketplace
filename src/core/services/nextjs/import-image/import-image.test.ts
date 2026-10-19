import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_IMAGE_FETCH_TIMEOUT_MS,
  IMPORT_IMAGE_MAX_BYTES,
  IMPORT_IMAGE_MAX_REDIRECTS,
} from '@/config/import-image';
import { followRedirects, importImageSafeLookup, NextJsImportImageService } from './import-image';

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

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4];

const PUBLIC_IP = '93.184.216.34';
const dnsError = () => Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });

function imageResponse(
  bytes: number[] | Uint8Array,
  headers: Record<string, string> = { 'content-type': 'image/png' },
) {
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function streamOf(chunks: Uint8Array[], onCancel?: () => void) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel: onCancel,
  });
}

function fetchImage(url: string, remainingBytes: number | null = null, signal?: AbortSignal) {
  return NextJsImportImageService.fetch({ url: new URL(url), remainingBytes, signal });
}

describe('NextJsImportImageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve4.mockResolvedValue([PUBLIC_IP]);
    mockResolve6.mockRejectedValue(dnsError());
  });

  describe('success path', () => {
    it('returns bytes and the type sniffed from them', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(PNG));
      const result = await fetchImage('https://cdn.example.com/a.png');
      expect(result).toEqual({ ok: true, bytes: new Uint8Array(PNG), mimeType: 'image/png' });
    });

    it('trusts the bytes over a lying image header', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(JPEG, { 'content-type': 'image/png' }));
      const result = await fetchImage('https://cdn.example.com/a.png');
      expect(result).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
    });

    it('accepts an opaque binary content type when the bytes are an image', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(PNG, { 'content-type': 'application/octet-stream' }));
      expect(await fetchImage('https://cdn.example.com/a')).toMatchObject({ ok: true, mimeType: 'image/png' });
    });

    it('sends no cookies, credentials, referrer or authorization', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(PNG));
      await fetchImage('https://cdn.example.com/a.png');
      const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string> }];
      expect(init.credentials).toBe('omit');
      expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.redirect).toBe('manual');
      const names = Object.keys(init.headers).map((name) => name.toLowerCase());
      expect(names).not.toContain('cookie');
      expect(names).not.toContain('authorization');
      expect(names).not.toContain('referer');
    });
  });

  describe('private and special-purpose addresses', () => {
    it.each([
      ['loopback v4', 'https://127.0.0.1/a.png'],
      ['loopback v4 range', 'https://127.1.2.3/a.png'],
      ['10/8', 'https://10.0.0.5/a.png'],
      ['172.16/12', 'https://172.16.0.1/a.png'],
      ['192.168/16', 'https://192.168.1.1/a.png'],
      ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
      ['CGNAT', 'https://100.64.0.1/a.png'],
      ['this-network', 'https://0.0.0.0/a.png'],
      ['multicast v4', 'https://224.0.0.1/a.png'],
      ['reserved v4', 'https://240.0.0.1/a.png'],
      ['decimal-encoded loopback', 'https://2130706433/a.png'],
      ['hex-encoded loopback', 'https://0x7f.1/a.png'],
      ['octal-encoded loopback', 'https://0177.0.0.1/a.png'],
      ['loopback v6', 'https://[::1]/a.png'],
      ['unspecified v6', 'https://[::]/a.png'],
      ['unique-local v6', 'https://[fd00::1]/a.png'],
      ['link-local v6', 'https://[fe80::1]/a.png'],
      ['multicast v6', 'https://[ff02::1]/a.png'],
      ['v4-mapped loopback', 'https://[::ffff:127.0.0.1]/a.png'],
      ['v4-mapped metadata', 'https://[::ffff:a9fe:a9fe]/a.png'],
      ['NAT64 of metadata', 'https://[64:ff9b::a9fe:a9fe]/a.png'],
      ['6to4', 'https://[2002:7f00:1::1]/a.png'],
    ])('refuses %s without opening a connection', async (_name, url) => {
      const result = await fetchImage(url);
      expect(result).toMatchObject({ ok: false, reason: 'blocked_address' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses a hostname that resolves to a private IPv4 address', async () => {
      mockResolve4.mockResolvedValue(['10.1.2.3']);
      expect(await fetchImage('https://shop.example.com/a.png')).toMatchObject({ reason: 'blocked_address' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses a hostname that resolves to a private IPv6 address', async () => {
      mockResolve4.mockRejectedValue(dnsError());
      mockResolve6.mockResolvedValue(['fd12:3456::1']);
      expect(await fetchImage('https://shop.example.com/a.png')).toMatchObject({ reason: 'blocked_address' });
    });

    it('refuses when only one of several answers is private (mixed A records)', async () => {
      mockResolve4.mockResolvedValue([PUBLIC_IP, '192.168.0.9']);
      expect(await fetchImage('https://shop.example.com/a.png')).toMatchObject({ reason: 'blocked_address' });
    });

    it('reports an unresolvable host as dns_failed', async () => {
      mockResolve4.mockRejectedValue(dnsError());
      expect(await fetchImage('https://nope.example.com/a.png')).toMatchObject({ ok: false, reason: 'dns_failed' });
    });

    it('pins the connection to vetted addresses and rejects private answers at connect time', async () => {
      const call = (hostname: string, options: Record<string, unknown> = {}) =>
        new Promise<{ error: Error | null; address: unknown }>((resolve) => {
          importImageSafeLookup(
            hostname,
            options as never,
            ((error: Error | null, address: unknown) => resolve({ error, address })) as never,
          );
        });

      const ok = await call('shop.example.com', { all: true });
      expect(ok.error).toBeNull();
      expect(ok.address).toEqual([{ address: PUBLIC_IP, family: 4 }]);

      mockResolve4.mockResolvedValue(['127.0.0.1']);
      const rebound = await call('shop.example.com', { all: true });
      expect(rebound.error).toBeInstanceOf(Error);
      expect(rebound.error?.name).toBe('ImportImageTransportError');
    });
  });

  describe('redirects', () => {
    it('follows a redirect to another public https host', async () => {
      mockFetch
        .mockResolvedValueOnce(redirectTo('https://img.example.net/final.png'))
        .mockResolvedValueOnce(imageResponse(PNG));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ ok: true });
      expect(String(mockFetch.mock.calls[1][0])).toBe('https://img.example.net/final.png');
    });

    it('releases the body of every redirect response before following it', async () => {
      const cancel = vi.fn();
      mockFetch
        .mockResolvedValueOnce(
          new Response(streamOf([new Uint8Array(8)], cancel), {
            status: 302,
            headers: { location: 'https://img.example.net/final.png' },
          }),
        )
        .mockResolvedValueOnce(imageResponse(PNG));
      await fetchImage('https://cdn.example.com/a.png');
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('resolves relative Location headers against the current URL', async () => {
      mockFetch.mockResolvedValueOnce(redirectTo('/moved/a.png', 301)).mockResolvedValueOnce(imageResponse(PNG));
      await fetchImage('https://cdn.example.com/a.png');
      expect(String(mockFetch.mock.calls[1][0])).toBe('https://cdn.example.com/moved/a.png');
    });

    it.each([
      ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
      ['loopback', 'https://127.0.0.1/admin'],
      ['private range', 'https://10.0.0.8/a.png'],
      ['IPv6 loopback', 'https://[::1]/a.png'],
    ])('refuses a redirect to %s and never connects to it', async (_name, location) => {
      mockFetch.mockResolvedValueOnce(redirectTo(location));
      const result = await fetchImage('https://cdn.example.com/a.png');
      expect(result).toMatchObject({ ok: false, reason: 'blocked_address' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('refuses a redirect to a hostname that resolves private', async () => {
      mockResolve4.mockImplementation(async (hostname) =>
        hostname === 'evil.example.org' ? ['10.9.9.9'] : [PUBLIC_IP],
      );
      mockFetch.mockResolvedValueOnce(redirectTo('https://evil.example.org/a.png'));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'blocked_address' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['http downgrade', 'http://cdn.example.com/a.png'],
      ['file scheme', 'file:///etc/passwd'],
      ['credentials', 'https://user:pw@cdn.example.com/a.png'],
      ['non-default port', 'https://cdn.example.com:8443/a.png'],
    ])('refuses a redirect with %s', async (_name, location) => {
      mockFetch.mockResolvedValueOnce(redirectTo(location));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ ok: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('caps the redirect chain', async () => {
      mockFetch.mockImplementation(async () => redirectTo('https://cdn.example.com/loop.png'));
      const result = await fetchImage('https://cdn.example.com/a.png');
      expect(result).toMatchObject({ ok: false, reason: 'too_many_redirects' });
      expect(mockFetch).toHaveBeenCalledTimes(IMPORT_IMAGE_MAX_REDIRECTS + 1);
    });

    it('follows as many redirects as the caller allows, and no more, when the caller sets its own cap', async () => {
      mockFetch.mockImplementation(async () => redirectTo('https://a.example.com/again'));
      const result = await followRedirects(new URL('https://a.example.com/0'), new AbortController().signal, {}, 1);
      expect(result).toMatchObject({ ok: false, reason: 'too_many_redirects' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('treats a redirect without Location as an http error', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 302 }));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'http_error', status: 302 });
    });
  });

  describe('address pinning on every hop', () => {
    it('sends every hop through the dispatcher whose connect lookup is the vetted lookup', async () => {
      mockFetch
        .mockResolvedValueOnce(redirectTo('https://b.example.net/1.png'))
        .mockResolvedValueOnce(redirectTo('https://c.example.org/2.png'))
        .mockResolvedValueOnce(imageResponse(PNG));
      await fetchImage('https://a.example.com/0.png');

      expect(agentOptions).toHaveLength(1);
      expect(agentOptions[0].connect?.lookup).toBe(importImageSafeLookup);
      const dispatchers = mockFetch.mock.calls.map(([, init]) => (init as { dispatcher: unknown }).dispatcher);
      expect(dispatchers).toHaveLength(3);
      expect(dispatchers.every((dispatcher) => dispatcher === agentInstances[0])).toBe(true);
    });

    it('re-resolves DNS for every hop instead of reusing an earlier answer', async () => {
      mockFetch
        .mockResolvedValueOnce(redirectTo('https://b.example.net/1.png'))
        .mockResolvedValueOnce(redirectTo('https://a.example.com/again.png'))
        .mockResolvedValueOnce(imageResponse(PNG));
      await fetchImage('https://a.example.com/0.png');

      expect(mockResolve4.mock.calls.map(([hostname]) => hostname)).toEqual([
        'a.example.com',
        'b.example.net',
        'a.example.com',
      ]);
    });

    it('refuses a hop whose hostname re-resolves to a private address after an earlier public answer (rebinding)', async () => {
      mockResolve4.mockResolvedValueOnce([PUBLIC_IP]).mockResolvedValueOnce(['169.254.169.254']);
      mockFetch.mockResolvedValueOnce(redirectTo('https://a.example.com/second.png'));

      expect(await fetchImage('https://a.example.com/first.png')).toMatchObject({
        ok: false,
        reason: 'blocked_address',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('size caps', () => {
    it('refuses early when Content-Length exceeds the per-image cap', async () => {
      mockFetch.mockResolvedValueOnce(
        imageResponse(PNG, { 'content-type': 'image/png', 'content-length': String(IMPORT_IMAGE_MAX_BYTES + 1) }),
      );
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'too_large' });
    });

    it('stops reading a body that outgrows the cap despite a small Content-Length', async () => {
      const cancel = vi.fn();
      const chunk = new Uint8Array(1024 * 1024);
      chunk.set(PNG);
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      });
      mockFetch.mockResolvedValueOnce(
        new Response(endless, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '100' } }),
      );
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'too_large' });
      expect(cancel).toHaveBeenCalled();
    });

    it('reports budget_exceeded when the remaining import budget is the binding limit', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(new Uint8Array(2048).fill(0).map((_, i) => PNG[i] ?? 0)));
      expect(await fetchImage('https://cdn.example.com/a.png', 1024)).toMatchObject({ reason: 'budget_exceeded' });
    });

    it('reports budget_exceeded from Content-Length against the remaining budget', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse(PNG, { 'content-type': 'image/png', 'content-length': '5000' }));
      expect(await fetchImage('https://cdn.example.com/a.png', 4096)).toMatchObject({ reason: 'budget_exceeded' });
    });
  });

  describe('content type', () => {
    it.each([
      ['html', 'text/html'],
      ['json', 'application/json'],
      ['svg', 'image/svg+xml'],
      ['video', 'video/mp4'],
    ])('refuses a declared %s response before reading the body', async (_name, contentType) => {
      const cancel = vi.fn();
      mockFetch.mockResolvedValueOnce(
        new Response(streamOf([new Uint8Array(PNG)], cancel), {
          status: 200,
          headers: { 'content-type': contentType },
        }),
      );
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'not_image' });
      expect(cancel).toHaveBeenCalled();
    });

    it('refuses HTML served with an image content type (sniffed from bytes)', async () => {
      const html = new TextEncoder().encode('<!DOCTYPE html><html><body>nope</body></html>');
      mockFetch.mockResolvedValueOnce(imageResponse(html, { 'content-type': 'image/jpeg' }));
      expect(await fetchImage('https://cdn.example.com/a.jpg')).toMatchObject({ reason: 'not_image' });
    });

    it('refuses SVG served with an image/png content type', async () => {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      mockFetch.mockResolvedValueOnce(imageResponse(svg, { 'content-type': 'image/png' }));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'not_image' });
    });

    it('refuses an empty body', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse([]));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'not_image' });
    });

    it('refuses a tiny non-image body shorter than the sniff window', async () => {
      mockFetch.mockResolvedValueOnce(imageResponse([0x41, 0x42]));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'not_image' });
    });
  });

  describe('failures and timeouts', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('maps non-2xx statuses to http_error with the status', async () => {
      mockFetch.mockResolvedValueOnce(new Response('gone', { status: 404 }));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'http_error', status: 404 });
    });

    it('maps a connect failure to network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect(await fetchImage('https://cdn.example.com/a.png')).toMatchObject({ reason: 'network' });
    });

    it('maps a connection-time blocked lookup to blocked_address', async () => {
      const cause = Object.assign(new Error('Import image transport failure: blocked_address'), {
        name: 'ImportImageTransportError',
      });
      mockResolve4.mockResolvedValue(['127.0.0.1']);
      const lookupError = await new Promise<Error>((resolve) => {
        importImageSafeLookup(
          'rebind.example.com',
          { all: true } as never,
          ((error: Error) => resolve(error)) as never,
        );
      });
      expect(lookupError.name).toBe(cause.name);
      mockResolve4.mockResolvedValue([PUBLIC_IP]);
      mockFetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: lookupError }));
      expect(await fetchImage('https://rebind.example.com/a.png')).toMatchObject({ reason: 'blocked_address' });
    });

    it('times out when the server never answers', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = fetchImage('https://cdn.example.com/slow.png');
      await vi.advanceTimersByTimeAsync(IMPORT_IMAGE_FETCH_TIMEOUT_MS + 10);
      expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
    });

    it('times out a body that stalls after the headers (slow-loris)', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation((_url: URL, init: RequestInit) => {
        const stalled = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(PNG.slice(0, 4)));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
          pull: () => new Promise(() => {}),
        });
        return Promise.resolve(new Response(stalled, { status: 200, headers: { 'content-type': 'image/png' } }));
      });
      const pending = fetchImage('https://cdn.example.com/stall.png');
      await vi.advanceTimersByTimeAsync(IMPORT_IMAGE_FETCH_TIMEOUT_MS + 10);
      expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
    });

    it('reports cancelled when the caller aborts', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = fetchImage('https://cdn.example.com/a.png', null, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    });
  });
});
