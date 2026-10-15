import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportImageApiService } from './import-image.api';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe('ImportImageApiService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the URL and remaining budget, same-origin, uncached', async () => {
    fetchMock.mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    const result = await ImportImageApiService.fetchImage({ url: 'https://cdn.example.com/a.png', remainingBytes: 99 });

    expect(result).toEqual({ ok: true, bytes: PNG, mimeType: 'image/png' });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/import-image');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({ url: 'https://cdn.example.com/a.png', remainingBytes: 99 });
  });

  it('reads the failure reason and Retry-After from an error response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ reason: 'rate_limited' }), { status: 429, headers: { 'retry-after': '7' } }),
    );
    expect(await ImportImageApiService.fetchImage({ url: 'u', remainingBytes: 1 })).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 7,
    });
  });

  it('falls back to network for an unreadable or unknown error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await ImportImageApiService.fetchImage({ url: 'u', remainingBytes: 1 })).toMatchObject({
      reason: 'network',
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'made_up' }), { status: 400 }));
    expect(await ImportImageApiService.fetchImage({ url: 'u', remainingBytes: 1 })).toMatchObject({
      reason: 'network',
    });
  });

  it('reports network when the request itself fails and cancelled when aborted', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await ImportImageApiService.fetchImage({ url: 'u', remainingBytes: 1 })).toMatchObject({
      reason: 'network',
    });

    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    expect(
      await ImportImageApiService.fetchImage({ url: 'u', remainingBytes: 1, signal: controller.signal }),
    ).toMatchObject({ reason: 'cancelled' });
  });
});
