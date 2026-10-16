import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_STORE_MAX_REQUEST_BODY_BYTES } from '@/config/import-store';
import { ImportStoreController } from '@/controllers/import-store/import-store';
import { HttpStatusCode } from '@/libs/http/http.types';
import { POST } from './route';

const PAGE_BODY = { storeUrl: 'https://shop.example.com', kind: 'page', page: 1 };

function createRequest(
  body: unknown,
  { headers = {}, rawBody }: { headers?: Record<string, string>; rawBody?: string } = {},
) {
  return new NextRequest('http://localhost:3000/api/import-store', {
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

describe('API Route: /api/import-store', () => {
  const fetchSpy = vi.spyOn(ImportStoreController, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy.mockResolvedValue({
      ok: true,
      response: { kind: 'page', products: [], rejected: 0, total: 0, totalPages: 0, bytes: 2 },
    });
  });

  it('returns the trimmed response as JSON with hardening headers and no caching', async () => {
    const response = await POST(createRequest(PAGE_BODY));
    expect(response.status).toBe(HttpStatusCode.OK);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({
      kind: 'page',
      products: [],
      rejected: 0,
      total: 0,
      totalPages: 0,
      bytes: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ body: PAGE_BODY }));
  });

  it.each([
    ['invalid_url', HttpStatusCode.BAD_REQUEST],
    ['blocked_address', HttpStatusCode.FORBIDDEN],
    ['not_json', HttpStatusCode.UNPROCESSABLE_ENTITY],
    ['not_woocommerce', HttpStatusCode.UNPROCESSABLE_ENTITY],
    ['too_large', HttpStatusCode.PAYLOAD_TOO_LARGE],
    ['budget_exceeded', HttpStatusCode.PAYLOAD_TOO_LARGE],
    ['timeout', HttpStatusCode.GATEWAY_TIMEOUT],
    ['http_error', HttpStatusCode.BAD_GATEWAY],
    ['dns_failed', HttpStatusCode.BAD_GATEWAY],
  ] as const)('maps %s to HTTP %s with a JSON reason', async (reason, status) => {
    fetchSpy.mockResolvedValueOnce({ ok: false, reason });
    const response = await POST(createRequest(PAGE_BODY));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ reason });
  });

  it('answers 429 with Retry-After when the limiter refuses', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, reason: 'rate_limited', retryAfterSeconds: 17 });
    const response = await POST(createRequest(PAGE_BODY));
    expect(response.status).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
    expect(response.headers.get('retry-after')).toBe('17');
  });

  it('refuses cross-site callers and non-JSON, oversized and malformed bodies before any fetch', async () => {
    expect((await POST(createRequest(PAGE_BODY, { headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(
      HttpStatusCode.FORBIDDEN,
    );
    const noFetchSite = createRequest(PAGE_BODY, { headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } });
    expect((await POST(noFetchSite)).status).toBe(HttpStatusCode.FORBIDDEN);
    expect((await POST(createRequest(PAGE_BODY, { headers: { 'content-type': 'text/plain' } }))).status).toBe(
      HttpStatusCode.BAD_REQUEST,
    );
    expect((await POST(createRequest(null, { rawBody: '{"storeUrl":' }))).status).toBe(HttpStatusCode.BAD_REQUEST);
    expect((await POST(createRequest(null, { rawBody: '[]' }))).status).toBe(HttpStatusCode.BAD_REQUEST);
    const huge = JSON.stringify({ ...PAGE_BODY, pad: 'x'.repeat(IMPORT_STORE_MAX_REQUEST_BODY_BYTES) });
    expect((await POST(createRequest(null, { rawBody: huge }))).status).toBe(HttpStatusCode.PAYLOAD_TOO_LARGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keys the limiter on the caller IP and, when there is one, a digest of the session cookie', async () => {
    await POST(createRequest(PAGE_BODY, { headers: { cookie: '__Host-shop-bff-session=secret-token' } }));
    const keys = fetchSpy.mock.calls[0]?.[0].rateLimitKeys ?? [];
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^ip:/);
    expect(keys[1]).toMatch(/^session:[0-9a-f]{64}$/);
    expect(keys.join(',')).not.toContain('secret-token');
  });
});
