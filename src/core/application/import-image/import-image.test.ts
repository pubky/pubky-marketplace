import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_IMAGE_RATE_LIMIT_REQUESTS } from '@/config/import-image';
import { NextJsImportImageService } from '@/services/nextjs/import-image/import-image';
import { ImportImageRateLimiter } from '@/services/nextjs/import-image/import-image.rate-limit';
import { ImportImageApplication } from './import-image';

const url = new URL('https://cdn.example.com/a.png');
const bytes = new Uint8Array(2048);

describe('ImportImageApplication', () => {
  const serviceSpy = vi.spyOn(NextJsImportImageService, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    ImportImageRateLimiter.resetForTests();
    serviceSpy.mockResolvedValue({ ok: true, bytes, mimeType: 'image/png' });
  });

  it('answers rate_limited with a retry hint and skips the fetch once a key is exhausted', async () => {
    for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) {
      await ImportImageApplication.fetch({ url, rateLimitKeys: ['session:a'], remainingBytes: null });
    }
    serviceSpy.mockClear();

    const result = await ImportImageApplication.fetch({ url, rateLimitKeys: ['session:a'], remainingBytes: null });
    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(result.ok === false && result.retryAfterSeconds).toBeGreaterThan(0);
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('enforces every key: an exhausted IP bucket blocks a fresh session', async () => {
    for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) {
      await ImportImageApplication.fetch({ url, rateLimitKeys: ['ip:1'], remainingBytes: null });
    }
    const result = await ImportImageApplication.fetch({
      url,
      rateLimitKeys: ['ip:1', 'session:fresh'],
      remainingBytes: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('does not charge failed fetches against the byte allowance', async () => {
    const recordSpy = vi.spyOn(ImportImageRateLimiter, 'recordBytes');
    serviceSpy.mockResolvedValueOnce({ ok: false, reason: 'not_image' });
    await ImportImageApplication.fetch({ url, rateLimitKeys: ['ip:1'], remainingBytes: null });
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('charges served bytes to every key', async () => {
    const recordSpy = vi.spyOn(ImportImageRateLimiter, 'recordBytes');
    await ImportImageApplication.fetch({ url, rateLimitKeys: ['ip:1', 'session:a'], remainingBytes: null });
    expect(recordSpy).toHaveBeenCalledWith('ip:1', bytes.byteLength);
    expect(recordSpy).toHaveBeenCalledWith('session:a', bytes.byteLength);
  });
});
