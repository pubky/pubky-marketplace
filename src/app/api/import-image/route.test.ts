import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES } from '@/config/import-image';
import { ImportImageController } from '@/controllers/import-image/import-image';
import { HttpStatusCode } from '@/libs/http/http.types';
import { POST } from './route';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function createRequest(
  body: unknown,
  { headers = {}, rawBody }: { headers?: Record<string, string>; rawBody?: string } = {},
) {
  return new NextRequest('http://localhost:3000/api/import-image', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost:3000',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

describe('API Route: /api/import-image', () => {
  const fetchSpy = vi.spyOn(ImportImageController, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy.mockResolvedValue({ ok: true, bytes: PNG, mimeType: 'image/png' });
  });

  it('returns the image bytes with hardening headers and no caching', async () => {
    const response = await POST(createRequest({ url: 'https://cdn.example.com/a.png', remainingBytes: 5000 }));

    expect(response.status).toBe(HttpStatusCode.OK);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://cdn.example.com/a.png', remainingBytes: 5000 }),
    );
  });

  it.each([
    ['invalid_url', HttpStatusCode.BAD_REQUEST],
    ['blocked_address', HttpStatusCode.FORBIDDEN],
    ['not_image', HttpStatusCode.UNPROCESSABLE_ENTITY],
    ['too_large', HttpStatusCode.PAYLOAD_TOO_LARGE],
    ['budget_exceeded', HttpStatusCode.PAYLOAD_TOO_LARGE],
    ['timeout', HttpStatusCode.GATEWAY_TIMEOUT],
    ['http_error', HttpStatusCode.BAD_GATEWAY],
  ] as const)('maps %s to HTTP %s with a JSON reason', async (reason, status) => {
    fetchSpy.mockResolvedValueOnce({ ok: false, reason });
    const response = await POST(createRequest({ url: 'https://cdn.example.com/a.png' }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ reason });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });

  it('sets Retry-After on rate limiting', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, reason: 'rate_limited', retryAfterSeconds: 42 });
    const response = await POST(createRequest({ url: 'https://cdn.example.com/a.png' }));
    expect(response.status).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
    expect(response.headers.get('retry-after')).toBe('42');
  });

  describe('same-origin guard', () => {
    const body = { url: 'https://cdn.example.com/a.png' };
    const withoutFetchSite = (headers: Record<string, string> = {}) => {
      const request = createRequest(body, { headers });
      request.headers.delete('sec-fetch-site');
      return request;
    };

    it.each(['cross-site', 'same-site', 'none'])('refuses Sec-Fetch-Site: %s', async (site) => {
      const response = await POST(createRequest(body, { headers: { 'sec-fetch-site': site } }));
      expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a request with neither Sec-Fetch-Site nor Origin (curl-style, form post)', async () => {
      const response = await POST(withoutFetchSite());
      expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a foreign Origin even when Host and X-Forwarded-Host are forged to match it', async () => {
      const response = await POST(
        withoutFetchSite({ origin: 'https://evil.example', host: 'evil.example', 'x-forwarded-host': 'evil.example' }),
      );
      expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses an unparseable Origin', async () => {
      expect((await POST(withoutFetchSite({ origin: 'not a url' }))).status).toBe(HttpStatusCode.FORBIDDEN);
    });

    it('allows Sec-Fetch-Site: same-origin', async () => {
      expect((await POST(createRequest(body))).status).toBe(HttpStatusCode.OK);
    });

    it('allows a browser without Sec-Fetch-Site when Origin matches the request host', async () => {
      const response = await POST(withoutFetchSite({ origin: 'http://localhost:3000' }));
      expect(response.status).toBe(HttpStatusCode.OK);
    });
  });

  it('requires a JSON content type', async () => {
    const response = await POST(
      createRequest(null, { headers: { 'content-type': 'text/plain' }, rawBody: '{"url":"https://a.example/x.png"}' }),
    );
    expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([['not json'], ['[]'], ['null'], ['"str"']])('rejects body %s', async (rawBody) => {
    const response = await POST(createRequest(null, { rawBody }));
    expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an oversized request body', async () => {
    const response = await POST(
      createRequest({ url: `https://cdn.example.com/${'a'.repeat(IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES)}` }),
    );
    expect(response.status).toBe(HttpStatusCode.PAYLOAD_TOO_LARGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rate limits per session cookie digest and per IP, never by the raw cookie', async () => {
    await POST(
      createRequest(
        { url: 'https://cdn.example.com/a.png' },
        { headers: { cookie: '__Host-shop-bff-session=secret-session-value', 'x-forwarded-for': '203.0.113.9' } },
      ),
    );
    const { rateLimitKeys } = fetchSpy.mock.calls[0][0];
    expect(rateLimitKeys).toHaveLength(2);
    expect(rateLimitKeys[0]).toMatch(/^ip:/);
    expect(rateLimitKeys[1]).toMatch(/^session:[a-f0-9]{64}$/);
    expect(rateLimitKeys.join()).not.toContain('secret-session-value');
  });

  it('uses only an IP bucket when there is no session cookie', async () => {
    await POST(createRequest({ url: 'https://cdn.example.com/a.png' }));
    expect(fetchSpy.mock.calls[0][0].rateLimitKeys).toEqual([expect.stringMatching(/^ip:/)]);
  });

  it('returns a generic 500 when the controller throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom with internal detail'));
    const response = await POST(createRequest({ url: 'https://cdn.example.com/a.png' }));
    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(await response.json())).not.toContain('internal detail');
  });
});
