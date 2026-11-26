import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MAX_UPLOAD_SIZE } from '@/config/images';
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

type TEncodedFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=1"><rect width="1" height="1"/></svg>';
const HTML = '<!doctype html><html><body><script>document.title = 1</script></body></html>';
const CHUNK_BYTES = 1024 * 1024;

async function encode(format: TEncodedFormat): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .toFormat(format)
    .toBuffer();
  return new Uint8Array(buffer);
}

function mediaResponse(body: BodyInit, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe('MarketplaceMediaService', () => {
  const owner = 'y'.repeat(52);
  const uri = `pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`;

  beforeEach(async () => {
    const png = await encode('png');
    fetchMock.mockImplementation(async () => mediaResponse(png, { 'content-type': 'image/png' }));
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

  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
  ] as const)('types a real %s image from its bytes, not the declared type', async (format, type) => {
    const bytes = await encode(format);
    fetchMock.mockResolvedValue(mediaResponse(bytes, { 'content-type': 'text/html' }));

    const blob = await MarketplaceMediaService.fetchMedia(uri);

    expect(blob.type).toBe(type);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ['image/png,text/html', HTML],
    ['image/x,image/svg+xml', SVG],
    ['image/svg+xml', SVG],
    ['text/html', HTML],
    ['image/png', SVG],
  ])(
    'shows no image for a body declared as %s that is not a raster image, without reporting it',
    async (type, body) => {
      fetchMock.mockResolvedValue(mediaResponse(body, { 'content-type': type }));
      const reportClient = vi.spyOn(Err, 'client');
      const reportServer = vi.spyOn(Err, 'server');

      const error = await MarketplaceMediaService.fetchMedia(uri).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: ClientErrorCode.UNPROCESSABLE, context: { reason: 'not_image' } });
      expect(reportClient).not.toHaveBeenCalled();
      expect(reportServer).not.toHaveBeenCalled();
    },
  );

  it('refuses a declared length over the upload cap before reading the body', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(CHUNK_BYTES));
        },
      },
      { highWaterMark: 0 },
    );
    fetchMock.mockResolvedValue(mediaResponse(body, { 'content-length': String(IMAGE_MAX_UPLOAD_SIZE + 1) }));

    await expect(MarketplaceMediaService.fetchMedia(uri)).rejects.toMatchObject({
      code: ClientErrorCode.PAYLOAD_TOO_LARGE,
      context: { reason: 'too_large', maxBytes: IMAGE_MAX_UPLOAD_SIZE },
    });
    expect(pulled).toBe(0);
  });

  it('stops an endless body with a false length at the upload cap', async () => {
    const png = await encode('png');
    let pulledBytes = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = pulledBytes === 0 ? png : new Uint8Array(CHUNK_BYTES);
          pulledBytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    fetchMock.mockResolvedValue(mediaResponse(body, { 'content-type': 'image/png', 'content-length': '96' }));

    await expect(MarketplaceMediaService.fetchMedia(uri)).rejects.toMatchObject({
      code: ClientErrorCode.PAYLOAD_TOO_LARGE,
    });
    expect(cancelled).toBe(true);
    expect(pulledBytes).toBeLessThanOrEqual(IMAGE_MAX_UPLOAD_SIZE + CHUNK_BYTES);
  });
});
