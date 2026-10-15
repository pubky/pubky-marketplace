import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_IMAGE_MAX_RETRY_WAIT_SECONDS } from '@/config/import-image';
import * as stripModule from '@/libs/image/stripImageMetadata';
import { ImportImageApiService } from '@/services/import-image/import-image.api';
import { ImportImageUploadApplication } from './import-image-upload';

const OWNER = 'o'.repeat(52);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
const params = { ownerPubky: OWNER, url: 'https://cdn.example.com/a.png', altText: 'Alt', remainingBytes: 1_000_000 };

describe('ImportImageUploadApplication.fetchAndPrepare', () => {
  const apiSpy = vi.spyOn(ImportImageApiService, 'fetchImage');
  const stripSpy = vi.spyOn(stripModule, 'stripImageMetadata');

  beforeEach(() => {
    vi.clearAllMocks();
    apiSpy.mockResolvedValue({ ok: true, bytes: PNG, mimeType: 'image/png' });
    stripSpy.mockImplementation(async (file) => new File([PNG], 'clean.png', { type: file.type }));
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('builds a media record owned by the seller from the sanitized bytes', async () => {
    const result = await ImportImageUploadApplication.fetchAndPrepare(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fetchedBytes).toBe(PNG.byteLength);
    expect(result.media).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      altText: 'Alt',
      byteSize: PNG.byteLength,
    });
    expect(result.media.url).toBe(`pubky://${OWNER}/pub/pubky.app/marketplace/v1/media/${result.media.id}`);
    expect(result.media.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('passes the failure reason through when the route refuses', async () => {
    apiSpy.mockResolvedValueOnce({ ok: false, reason: 'blocked_address' });
    expect(await ImportImageUploadApplication.fetchAndPrepare(params)).toEqual({
      ok: false,
      reason: 'blocked_address',
      fetchedBytes: 0,
    });
    expect(stripSpy).not.toHaveBeenCalled();
  });

  it('re-checks the bytes it receives and refuses a non-image', async () => {
    apiSpy.mockResolvedValueOnce({
      ok: true,
      bytes: new TextEncoder().encode('<html>not an image</html>'),
      mimeType: 'image/png',
    });
    expect(await ImportImageUploadApplication.fetchAndPrepare(params)).toMatchObject({
      ok: false,
      reason: 'not_image',
    });
  });

  it('refuses bytes larger than the remaining budget and still counts them', async () => {
    const result = await ImportImageUploadApplication.fetchAndPrepare({ ...params, remainingBytes: 4 });
    expect(result).toMatchObject({ ok: false, reason: 'budget_exceeded', fetchedBytes: PNG.byteLength });
  });

  it('reports decode_failed when sanitising or decoding fails', async () => {
    stripSpy.mockRejectedValueOnce(new Error('cannot compress'));
    expect(await ImportImageUploadApplication.fetchAndPrepare(params)).toMatchObject({
      ok: false,
      reason: 'decode_failed',
      fetchedBytes: PNG.byteLength,
    });
  });

  it('waits out a short rate limit once and retries', async () => {
    vi.useFakeTimers();
    apiSpy.mockResolvedValueOnce({ ok: false, reason: 'rate_limited', retryAfterSeconds: 5 });
    const pending = ImportImageUploadApplication.fetchAndPrepare(params);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).ok).toBe(true);
    expect(apiSpy).toHaveBeenCalledTimes(2);
  });

  it('gives the image up when the rate-limit wait is too long', async () => {
    apiSpy.mockResolvedValueOnce({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: IMPORT_IMAGE_MAX_RETRY_WAIT_SECONDS + 1,
    });
    expect(await ImportImageUploadApplication.fetchAndPrepare(params)).toMatchObject({ reason: 'rate_limited' });
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    apiSpy.mockResolvedValueOnce({ ok: false, reason: 'rate_limited', retryAfterSeconds: 30 });
    const pending = ImportImageUploadApplication.fetchAndPrepare({ ...params, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });
});
