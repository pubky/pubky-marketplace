import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportImageApplication } from '@/application/import-image/import-image';
import { ImportImageController } from './import-image';

describe('ImportImageController', () => {
  const applicationSpy = vi.spyOn(ImportImageApplication, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    applicationSpy.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), mimeType: 'image/png' });
  });

  it.each([
    ['http', 'http://cdn.example.com/a.png'],
    ['credentials', 'https://u:p@cdn.example.com/a.png'],
    ['missing', undefined],
  ])('rejects %s URLs before any fetch', async (_name, url) => {
    const result = await ImportImageController.fetch({ url, remainingBytes: null, rateLimitKeys: ['ip:1'] });
    expect(result).toEqual({ ok: false, reason: 'invalid_url' });
    expect(applicationSpy).not.toHaveBeenCalled();
  });

  it('passes a validated URL and a sanitised budget to the application', async () => {
    await ImportImageController.fetch({
      url: 'https://cdn.example.com/a.png',
      remainingBytes: 'lots',
      rateLimitKeys: ['ip:1'],
    });
    expect(applicationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: new URL('https://cdn.example.com/a.png'), remainingBytes: null }),
    );
  });
});
