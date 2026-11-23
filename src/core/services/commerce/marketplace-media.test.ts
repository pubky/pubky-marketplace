import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MAX_RAW_SIZE } from '@/config/images';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { MarketplaceMediaService } from './marketplace-media';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@synonymdev/pubky', () => ({
  Client: class {
    fetch = fetchMock;
  },
  PublicKey: {
    from: vi.fn(),
  },
  Pubky: {
    withClient: vi.fn(() => ({
      getHomeserverOf: vi.fn(),
    })),
  },
  resolvePubky: vi.fn((uri: string) => `https://resolved.example/${uri}`),
}));

vi.mock('@/config/network', () => ({
  getHomeserver: () => 'configured-homeserver',
  getHomeserverUrl: () => 'https://configured.example',
  getPkarrRelays: () => [],
}));

describe('MarketplaceMediaService', () => {
  const owner = 'y'.repeat(52);
  const uri = `pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`;

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response('media', { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [404, ClientErrorCode.NOT_FOUND],
    [410, ClientErrorCode.GONE],
  ])('answers media its owner removed (%i) without reporting it', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('missing', { status }));
    const reportClient = vi.spyOn(Err, 'client');
    const reportServer = vi.spyOn(Err, 'server');

    const error = await MarketplaceMediaService.fetchMedia(uri).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code, context: { statusCode: status } });
    expect(reportClient).not.toHaveBeenCalled();
    expect(reportServer).not.toHaveBeenCalled();
  });

  it('still reports a media request the homeserver failed', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 500 }));
    const reportServer = vi.spyOn(Err, 'server');

    await expect(MarketplaceMediaService.fetchMedia(uri)).rejects.toMatchObject({
      code: ServerErrorCode.INVALID_RESPONSE,
      message: 'Marketplace media request failed.',
      context: { statusCode: 500 },
    });
    expect(reportServer).toHaveBeenCalledOnce();
  });

  it('fetches public media without credentials', async () => {
    await MarketplaceMediaService.fetchMedia(`pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://resolved.example/pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`,
    );
  });

  describe('fetchProfileImage', () => {
    const blobUri = `pubky://${owner}/pub/pubky.app/blobs/0034A0X7NJ52H`;

    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
      (char) => char.charCodeAt(0),
    );
    const avifHeader = new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode('ftypavif'), 0, 0, 0, 0]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const html = '<!doctype html><script>alert(1)</script>';
    const image = (body: BodyInit, contentType: string) =>
      new Response(body, { status: 200, headers: { 'content-type': contentType } });

    it("reads a Pubky App blob from its owner's homeserver", async () => {
      fetchMock.mockResolvedValue(image(png, 'image/png'));

      const blob = await MarketplaceMediaService.fetchProfileImage(blobUri);

      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
      expect(blob.type).toBe('image/png');
      expect(fetchMock).toHaveBeenCalledWith(`https://resolved.example/${blobUri}`);
    });

    it.each([
      ['a valid PNG declared as HTML', png, 'text/html', 'image/png'],
      ['an AVIF declared as an untyped file', avifHeader, 'application/octet-stream', 'image/avif'],
    ])('types %s by its bytes', async (_label, body, contentType, type) => {
      fetchMock.mockResolvedValue(image(body, contentType));

      await expect(MarketplaceMediaService.fetchProfileImage(blobUri)).resolves.toMatchObject({ type });
    });

    it.each([
      ['an SVG', svg, 'image/svg+xml'],
      ['an SVG declared with a charset', svg, 'image/svg+xml;charset=utf-8'],
      ['an SVG declared in upper case', svg, 'IMAGE/SVG+XML'],
      ['an SVG declared as a PNG', svg, 'image/png'],
      ['an SVG declared as a list ending in SVG', svg, 'image/x,image/svg+xml'],
      ['HTML', html, 'text/html'],
      ['HTML declared as a list starting with PNG', html, 'image/png,text/html'],
      ['bytes declared as an image type they do not show', 'avif bytes', 'Image/AVIF; charset=binary'],
      ['an untyped file', 'bytes', 'application/octet-stream'],
    ])('refuses %s', async (_label, body, contentType) => {
      fetchMock.mockResolvedValue(image(body, contentType));

      await expect(MarketplaceMediaService.fetchProfileImage(blobUri)).rejects.toMatchObject({
        code: ServerErrorCode.INVALID_RESPONSE,
        message: 'Profile image is not a supported image.',
      });
    });

    it.each([
      ['without a length', {}],
      ['under a false length', { 'content-length': '12' }],
    ])('stops reading an oversized image %s at the limit', async (_label, headers: Record<string, string>) => {
      const chunk = new Uint8Array(1024 * 1024);
      let pulled = 0;
      let cancelled = false;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });
      fetchMock.mockResolvedValue(
        new Response(endless, { status: 200, headers: { 'content-type': 'image/png', ...headers } }),
      );

      await expect(MarketplaceMediaService.fetchProfileImage(blobUri)).rejects.toMatchObject({
        code: ServerErrorCode.INVALID_RESPONSE,
        message: 'Profile image is too large.',
      });
      expect(cancelled).toBe(true);
      expect(pulled).toBeLessThanOrEqual(IMAGE_MAX_RAW_SIZE + 2 * chunk.byteLength);
    });

    it('refuses an image declared over the limit without reading it', async () => {
      fetchMock.mockResolvedValue(
        new Response(png, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(IMAGE_MAX_RAW_SIZE + 1) },
        }),
      );

      await expect(MarketplaceMediaService.fetchProfileImage(blobUri)).rejects.toMatchObject({
        message: 'Profile image is too large.',
      });
    });

    it('refuses anything but a Pubky App blob before any request', async () => {
      for (const other of [uri, `pubky://${owner}/pub/pubky.app/profile.json`, 'https://cdn.example/avatar']) {
        await expect(MarketplaceMediaService.fetchProfileImage(other)).rejects.toMatchObject({
          code: ServerErrorCode.INVALID_RESPONSE,
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('answers a removed image without reporting it', async () => {
      fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
      const reportClient = vi.spyOn(Err, 'client');

      await expect(MarketplaceMediaService.fetchProfileImage(blobUri)).rejects.toMatchObject({
        code: ClientErrorCode.NOT_FOUND,
        message: 'Profile image was not found.',
      });
      expect(reportClient).not.toHaveBeenCalled();
    });
  });
});
