import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import { asOpaque } from '@/test-utils/type-assertions';

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('png')),
  })),
}));

const { fetchImageAsDataUri, OG_IMAGE_MAX_BYTES } = await import('./ogData');

describe('fetchImageAsDataUri', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('returns null for a nullish / empty url without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchImageAsDataUri(null)).toBeNull();
    expect(await fetchImageAsDataUri(undefined)).toBeNull();
    expect(await fetchImageAsDataUri('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    expect(await fetchImageAsDataUri('https://cdn.test/a.webp')).toBeNull();
  });

  it('returns null when the content-type is not an image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    expect(await fetchImageAsDataUri('https://cdn.test/a.webp')).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    expect(await fetchImageAsDataUri('https://cdn.test/a.webp')).toBeNull();
  });

  it('rejects an oversized declared body without reading it', async () => {
    const getReader = vi.fn(() => {
      throw new Error('body must not be read');
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asOpaque<Response>({
        ok: true,
        headers: new Headers({
          'Content-Type': 'image/png',
          'Content-Length': String(OG_IMAGE_MAX_BYTES + 1),
        }),
        body: { getReader },
      }),
    );

    await expect(fetchImageAsDataUri('https://cdn.test/oversized.png')).resolves.toBeNull();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('stops reading an oversized chunked body without a content length', async () => {
    let readCount = 0;
    let cancelled = false;
    const reader = {
      read: vi.fn(async () => {
        readCount += 1;
        return readCount === 1
          ? { done: false, value: new Uint8Array(OG_IMAGE_MAX_BYTES + 1) }
          : { done: true, value: undefined };
      }),
      cancel: vi.fn(async () => {
        cancelled = true;
      }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asOpaque<Response>({
        ok: true,
        headers: new Headers({ 'Content-Type': 'image/png' }),
        body: { getReader: () => reader },
      }),
    );

    await expect(fetchImageAsDataUri('https://cdn.test/chunked.png')).resolves.toBeNull();
    expect(readCount).toBe(1);
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  it.each(['garbage', '-1'])('streams a body when content length is %s', async (contentLength) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': contentLength } }),
    );

    await expect(fetchImageAsDataUri('https://cdn.test/streamed.png')).resolves.toMatch(/^data:image\/png;base64,/);
    expect(vi.mocked(sharp)).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly the streamed cap and rejects one byte over it', async () => {
    const makeResponse = (totalBytes: number, cancel: () => Promise<void>) => {
      const chunkSize = 1024 * 1024;
      let emitted = 0;
      const stream = new ReadableStream({
        pull(controller) {
          const chunk = Math.min(chunkSize, totalBytes - emitted);
          emitted += chunk;
          controller.enqueue(new Uint8Array(chunk));
          if (emitted === totalBytes) controller.close();
        },
      });
      const reader = stream.getReader();
      vi.spyOn(reader, 'cancel').mockImplementation(cancel);
      return asOpaque<Response>({
        ok: true,
        headers: new Headers({ 'Content-Type': 'image/png' }),
        body: { getReader: () => reader },
      });
    };
    const loggerWarn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        OG_IMAGE_MAX_BYTES,
        vi.fn(async () => undefined),
      ),
    );
    await expect(fetchImageAsDataUri('https://cdn.test/exact-stream.png')).resolves.toMatch(/^data:image\/png;base64,/);

    const sharpCallsBeforeOverCap = vi.mocked(sharp).mock.calls.length;
    const warningsBeforeOverCap = loggerWarn.mock.calls.length;
    const cancel = vi.fn(async () => undefined);
    fetchMock.mockResolvedValueOnce(makeResponse(OG_IMAGE_MAX_BYTES + 1, cancel));
    await expect(fetchImageAsDataUri('https://cdn.test/over-stream.png')).resolves.toBeNull();
    expect(loggerWarn).toHaveBeenCalledTimes(warningsBeforeOverCap + 1);
    expect(loggerWarn).toHaveBeenCalledWith(
      '[ogData] Rejected oversized image body for OG',
      expect.objectContaining({ maxBytes: OG_IMAGE_MAX_BYTES }),
    );
    expect(vi.mocked(sharp)).toHaveBeenCalledTimes(sharpCallsBeforeOverCap);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejecting cancel on the over-cap path', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const reader = stream.getReader();
    const rejection = Promise.reject(new Error('cancel failed'));
    const rejectionCatch = vi.spyOn(rejection, 'catch');
    rejection.then(undefined, () => undefined);
    const cancel = vi.spyOn(reader, 'cancel').mockImplementation(() => rejection);
    const loggerWarn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        asOpaque<Response>({
          ok: true,
          headers: new Headers({ 'Content-Type': 'image/png' }),
          body: { getReader: () => reader },
        }),
      );

      await expect(fetchImageAsDataUri('https://cdn.test/rejecting-cancel.png')).resolves.toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(rejectionCatch).toHaveBeenCalledTimes(1);
      expect(loggerWarn).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('returns null and cancels once when reading the body fails', async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          return;
        }
        throw new Error('read failed');
      },
    });
    const reader = stream.getReader();
    const cancel = vi.spyOn(reader, 'cancel');
    const loggerWarn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asOpaque<Response>({
        ok: true,
        headers: new Headers({ 'Content-Type': 'image/png' }),
        body: { getReader: () => reader },
      }),
    );

    await expect(fetchImageAsDataUri('https://cdn.test/read-error.png')).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).not.toHaveBeenCalledWith('[ogData] Rejected oversized image body for OG', expect.anything());
  });

  it('rejects an oversized declared body without touching the response body', async () => {
    let bodyAccessed = false;
    let getReaderCalled = false;
    const loggerWarn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const response = asOpaque<Response>({
      ok: true,
      headers: new Headers({
        'Content-Type': 'image/png',
        'Content-Length': String(OG_IMAGE_MAX_BYTES + 1),
      }),
      get body() {
        bodyAccessed = true;
        return {
          getReader: () => {
            getReaderCalled = true;
            throw new Error('body must not be read');
          },
        };
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(fetchImageAsDataUri('https://cdn.test/header-only.png')).resolves.toBeNull();
    expect(bodyAccessed).toBe(false);
    expect(getReaderCalled).toBe(false);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      '[ogData] Rejected oversized image body for OG',
      expect.objectContaining({ maxBytes: OG_IMAGE_MAX_BYTES }),
    );
  });

  it('accepts a body whose declared length is exactly at the cap', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(png), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(OG_IMAGE_MAX_BYTES) },
      }),
    );

    await expect(fetchImageAsDataUri('https://cdn.test/exact.png')).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('transcodes a fetched image to a base64 PNG data URI', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );

    const result = await fetchImageAsDataUri('https://cdn.test/a.png');

    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
