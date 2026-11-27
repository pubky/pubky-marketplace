import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import {
  fetchOgMediaAsDataUri,
  MEDIA_FETCH_TIMEOUT_MS,
  OG_MEDIA_CACHE_MAX_ENTRY_BYTES,
  resetOgCommerceCacheForTests,
} from './ogCommerceData';

const { fetchMock, resolvePubkyMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  resolvePubkyMock: vi.fn((url: string) => `https://resolved.example/${url}`),
}));

vi.mock('@synonymdev/pubky', () => ({
  Client: class {
    fetch = fetchMock;
  },
  resolvePubky: resolvePubkyMock,
}));

const seller = '8mmmaouyode95qf7scbt4moytceiga4we5i3fwra71xapmwguwdy';
const sellerMediaUri = `pubky://${seller}/pub/pubky.app/marketplace/v1/media/b313eeca407a42408e81d3e12d267fe5`;
const resolvedUrl = `https://_pubky.${seller}/pub/pubky.app/marketplace/v1/media/b313eeca407a42408e81d3e12d267fe5`;

describe('fetchOgMediaAsDataUri', () => {
  beforeEach(() => {
    resetOgCommerceCacheForTests();
    fetchMock.mockReset();
    resolvePubkyMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches pubky media from the PKARR-resolved seller homeserver', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    resolvePubkyMock.mockReturnValue(resolvedUrl);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );

    await expect(fetchOgMediaAsDataUri(sellerMediaUri)).resolves.toMatch(/^data:image\/png;base64,/);
    expect(resolvePubkyMock).toHaveBeenCalledWith(sellerMediaUri);
    expect(fetchMock).toHaveBeenCalledWith(
      resolvedUrl,
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
  });

  it('returns null when the PKARR-resolved media fetch is not found', async () => {
    resolvePubkyMock.mockReturnValue(resolvedUrl);
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(fetchOgMediaAsDataUri(sellerMediaUri)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(resolvedUrl, expect.any(Object));
  });

  it.each([
    'ftp://example.com/image.png',
    'not-a-media-uri',
    'pubky://not-z32/pub/pubky.app/marketplace/v1/media/image',
  ])('rejects malformed media URI %s without fetching', async (uri) => {
    await expect(fetchOgMediaAsDataUri(uri)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolvePubkyMock).not.toHaveBeenCalled();
  });

  it('skips caching encoded media data URIs exceeding OG_MEDIA_CACHE_MAX_ENTRY_BYTES', async () => {
    const noisyRaw = randomBytes(700 * 700 * 3);
    const largePng = await sharp(noisyRaw, { raw: { width: 700, height: 700, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const expectedBase64Bytes = Buffer.byteLength(`data:image/png;base64,${largePng.toString('base64')}`, 'utf8');
    expect(expectedBase64Bytes).toBeGreaterThan(OG_MEDIA_CACHE_MAX_ENTRY_BYTES);

    resolvePubkyMock.mockReturnValue(resolvedUrl);
    fetchMock
      .mockResolvedValueOnce(
        new Response(new Uint8Array(largePng), { status: 200, headers: { 'Content-Type': 'image/png' } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(largePng), { status: 200, headers: { 'Content-Type': 'image/png' } }),
      );

    await expect(fetchOgMediaAsDataUri(sellerMediaUri)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(fetchOgMediaAsDataUri(sellerMediaUri)).resolves.toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out a hung HTTP(S) media fetch, clears mediaInFlight, and recovers on the next call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 180, b: 0 } },
    })
      .png()
      .toBuffer();
    const httpUrl = 'https://cdn.example.test/hung-media.png';
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png' } }),
      );

    const hung = fetchOgMediaAsDataUri(httpUrl);
    await vi.advanceTimersByTimeAsync(MEDIA_FETCH_TIMEOUT_MS);
    await expect(hung).resolves.toBeNull();

    await expect(fetchOgMediaAsDataUri(httpUrl)).resolves.toMatch(/^data:image\/png;base64,/);
    expect(globalFetch).toHaveBeenCalledTimes(2);
  });

  it('times out a hung media body stream, cancels the reader, clears mediaInFlight, and recovers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 200 } },
    })
      .png()
      .toBuffer();
    let canceled = false;
    const hungStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([137, 80, 78, 71]));
      },
      cancel() {
        canceled = true;
      },
    });
    resolvePubkyMock.mockReturnValue(resolvedUrl);
    fetchMock
      .mockResolvedValueOnce(new Response(hungStream, { status: 200, headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png' } }),
      );

    const hung = fetchOgMediaAsDataUri(sellerMediaUri);
    await vi.advanceTimersByTimeAsync(MEDIA_FETCH_TIMEOUT_MS);
    await expect(hung).resolves.toBeNull();
    expect(canceled).toBe(true);

    await expect(fetchOgMediaAsDataUri(sellerMediaUri)).resolves.toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
