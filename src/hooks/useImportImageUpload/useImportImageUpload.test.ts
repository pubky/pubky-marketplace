import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import {
  IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS,
  IMPORT_IMAGE_MAX_COUNT,
  IMPORT_IMAGE_MAX_TOTAL_BYTES,
  IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS,
} from '@/config/import-image';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { uploadImportImages, useImportImageUpload } from './useImportImageUpload';

const OWNER = 'o'.repeat(52);

const prepared = (id: string, fetchedBytes = 100): TImportImagePrepareResult => ({
  ok: true,
  fetchedBytes,
  bytes: new Uint8Array([1, 2, 3]),
  media: {
    id,
    type: 'image',
    url: `pubky://${OWNER}/pub/pubky.app/marketplace/v1/media/${id}`,
    contentHash: 'a'.repeat(64),
    mimeType: 'image/png',
    byteSize: 3,
    width: 10,
    height: 10,
    altText: 'Imported product photo',
  },
});

describe('uploadImportImages', () => {
  const prepareSpy = vi.spyOn(ImportImageUploadController, 'fetchAndPrepare');
  const writeSpy = vi.spyOn(CommerceController, 'commitCreateMedia');

  beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    prepareSpy.mockImplementation(async () => prepared(`m${(counter += 1)}`));
    writeSpy.mockResolvedValue('pubky://ok');
  });

  it('uploads each image through the seller media write and returns a record per entry', async () => {
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
    });

    expect(results.map((result) => [result.url, result.status])).toEqual([
      ['https://a.example.com/1.png', 'uploaded'],
      ['https://a.example.com/2.png', 'uploaded'],
    ]);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledWith('m1', new Uint8Array([1, 2, 3]));
    expect(results[0].media?.id).toBe('m1');
  });

  it('reports a per-image failure with its reason and keeps going', async () => {
    prepareSpy
      .mockResolvedValueOnce({ ok: false, reason: 'blocked_address', fetchedBytes: 0 })
      .mockResolvedValueOnce(prepared('m2'))
      .mockResolvedValueOnce({ ok: false, reason: 'not_image', fetchedBytes: 50 });

    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png', 'https://a.example.com/3.png'],
    });

    expect(results.map(({ url, status, reason }) => ({ url, status, reason }))).toEqual([
      { url: 'https://a.example.com/1.png', status: 'failed', reason: 'blocked_address' },
      { url: 'https://a.example.com/2.png', status: 'uploaded', reason: undefined },
      { url: 'https://a.example.com/3.png', status: 'failed', reason: 'not_image' },
    ]);
  });

  it('reports upload_failed when the homeserver write throws, without losing later images', async () => {
    writeSpy.mockRejectedValueOnce(new Error('403 session lacks write access'));
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
    });
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'upload_failed' });
    expect(results[1].status).toBe('uploaded');
  });

  it('rejects malformed and non-https URLs locally without calling the route', async () => {
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['', 'http://a.example.com/1.png', 'not a url', 'https://10.0.0.1:8443/x.png'],
    });
    expect(results.every((result) => result.status === 'failed' && result.reason === 'invalid_url')).toBe(true);
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('uploads a repeated URL once and shares the result', async () => {
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', ' https://a.example.com/1.png '],
    });
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(results[0].media?.id).toBe(results[1].media?.id);
  });

  it('stops fetching once the per-import byte budget is spent and passes the remaining budget down', async () => {
    prepareSpy
      .mockResolvedValueOnce(prepared('m1', IMPORT_IMAGE_MAX_TOTAL_BYTES - 10))
      .mockResolvedValueOnce({ ok: false, reason: 'budget_exceeded', fetchedBytes: 20 });

    const { results, fetchedBytes } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png', 'https://a.example.com/3.png'],
    });

    expect(prepareSpy.mock.calls[1][0].remainingBytes).toBe(10);
    expect(results[1]).toMatchObject({ status: 'failed', reason: 'budget_exceeded' });
    expect(results[2]).toMatchObject({ status: 'failed', reason: 'budget_exceeded' });
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(fetchedBytes).toBe(IMPORT_IMAGE_MAX_TOTAL_BYTES + 10);
  });

  it('caps the number of distinct images per import', async () => {
    const urls = Array.from({ length: IMPORT_IMAGE_MAX_COUNT + 2 }, (_, i) => `https://a.example.com/${i}.png`);
    const { results } = await uploadImportImages({ ownerPubky: OWNER, urls });
    expect(prepareSpy).toHaveBeenCalledTimes(IMPORT_IMAGE_MAX_COUNT);
    expect(results.slice(-2).map((result) => result.reason)).toEqual(['limit_reached', 'limit_reached']);
  });

  it('marks the rest cancelled when aborted mid-run', async () => {
    const controller = new AbortController();
    prepareSpy.mockImplementationOnce(async () => {
      controller.abort();
      return prepared('m1');
    });
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
      signal: controller.signal,
    });
    expect(results[0].status).toBe('uploaded');
    expect(results[1]).toMatchObject({ status: 'failed', reason: 'cancelled' });
  });

  it('reports progress after every distinct image', async () => {
    const onProgress = vi.fn();
    await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
      onProgress,
    });
    expect(onProgress.mock.calls.map(([progress]) => [progress.done, progress.total])).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('uploadImportImages recording an upload before it is written', () => {
  const prepareSpy = vi.spyOn(ImportImageUploadController, 'fetchAndPrepare');
  const writeSpy = vi.spyOn(CommerceController, 'commitCreateMedia');

  beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    prepareSpy.mockImplementation(async () => prepared(`m${(counter += 1)}`));
    writeSpy.mockResolvedValue('pubky://ok');
  });

  it("hands over each photo's media record, and waits for it, before the file is written", async () => {
    const order: string[] = [];
    writeSpy.mockImplementation(async (id) => {
      order.push(`write ${String(id)}`);
      return 'pubky://ok';
    });
    await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
      onPrepared: async (url, media) => {
        order.push(`record ${media.id}`);
        await Promise.resolve();
        order.push(`recorded ${url.split('/').pop()}`);
      },
    });
    expect(order).toEqual(['record m1', 'recorded 1.png', 'write m1', 'record m2', 'recorded 2.png', 'write m2']);
  });

  it('writes nothing, and stops the run, when the record cannot be kept', async () => {
    await expect(
      uploadImportImages({
        ownerPubky: OWNER,
        urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
        onPrepared: async () => {
          throw new Error('storage unavailable');
        },
      }),
    ).rejects.toThrow('storage unavailable');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('is asked once per distinct photo and never for one that could not be prepared', async () => {
    prepareSpy.mockResolvedValueOnce({ ok: false, reason: 'not_image', fetchedBytes: 0 });
    const onPrepared = vi.fn(async () => undefined);
    await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png', 'https://a.example.com/2.png'],
      onPrepared,
    });
    expect(onPrepared).toHaveBeenCalledTimes(1);
    expect(onPrepared).toHaveBeenCalledWith('https://a.example.com/2.png', expect.objectContaining({ id: 'm1' }));
  });
});

describe('uploadImportImages when the route asks to slow down', () => {
  const prepareSpy = vi.spyOn(ImportImageUploadController, 'fetchAndPrepare');
  const writeSpy = vi.spyOn(CommerceController, 'commitCreateMedia');
  const limited = (retryAfterSeconds?: number): TImportImagePrepareResult => ({
    ok: false,
    reason: 'rate_limited',
    fetchedBytes: 0,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    let counter = 0;
    prepareSpy.mockImplementation(async () => prepared(`m${(counter += 1)}`));
    writeSpy.mockResolvedValue('pubky://ok');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits the Retry-After, counting the seconds down, then loads the same photo and carries on', async () => {
    prepareSpy.mockResolvedValueOnce(prepared('m1')).mockResolvedValueOnce(limited(3));
    const onWait = vi.fn();
    const pending = uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png', 'https://a.example.com/3.png'],
      onWait,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    const { results } = await pending;
    expect(onWait.mock.calls.map(([seconds]) => seconds)).toEqual([3, 2, 1, null]);
    expect(results.map((result) => result.status)).toEqual(['uploaded', 'uploaded', 'uploaded']);
    expect(prepareSpy).toHaveBeenCalledTimes(4);
    expect(prepareSpy.mock.calls[1]?.[0].url).toBe(prepareSpy.mock.calls[2]?.[0].url);
  });

  it('does not wait for a Retry-After over the bound, and gives that photo up as rate limited', async () => {
    prepareSpy.mockResolvedValueOnce(limited(IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS + 1));
    const onWait = vi.fn();
    const { results } = await uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
      onWait,
    });
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'rate_limited' });
    expect(results[1]?.status).toBe('uploaded');
    expect(onWait).not.toHaveBeenCalled();
  });

  it('gives a photo up as rate limited when the route gives no wait to follow', async () => {
    prepareSpy.mockResolvedValueOnce(limited());
    const { results } = await uploadImportImages({ ownerPubky: OWNER, urls: ['https://a.example.com/1.png'] });
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'rate_limited' });
    expect(prepareSpy).toHaveBeenCalledTimes(1);
  });

  it('stops waiting once the run has waited its fill, leaving the rest as rate limited', async () => {
    prepareSpy.mockImplementation(async () => limited(IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS));
    const pending = uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png', 'https://a.example.com/2.png'],
    });
    await vi.advanceTimersByTimeAsync(IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS * 1_000);
    const { results } = await pending;
    expect(results.map((result) => result.reason)).toEqual(['rate_limited', 'rate_limited']);
    const waitedSeconds = (prepareSpy.mock.calls.length - 2) * IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS;
    expect(waitedSeconds).toBeLessThanOrEqual(IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS);
  });

  it('stops waiting when cancelled, and clears the wait', async () => {
    prepareSpy.mockResolvedValueOnce(limited(30));
    const controller = new AbortController();
    const onWait = vi.fn();
    const pending = uploadImportImages({
      ownerPubky: OWNER,
      urls: ['https://a.example.com/1.png'],
      signal: controller.signal,
      onWait,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    const { results } = await pending;
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(onWait.mock.calls.at(-1)).toEqual([null]);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useImportImageUpload', () => {
  const prepareSpy = vi.spyOn(ImportImageUploadController, 'fetchAndPrepare');
  const writeSpy = vi.spyOn(CommerceController, 'commitCreateMedia');

  beforeEach(() => {
    vi.clearAllMocks();
    prepareSpy.mockResolvedValue(prepared('m1'));
    writeSpy.mockResolvedValue('pubky://ok');
  });

  it('does nothing without a signed-in seller', async () => {
    const { result } = renderHook(() => useImportImageUpload(null));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run(['https://a.example.com/1.png']);
    });
    expect(outcome).toBeNull();
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('exposes results and progress after a run', async () => {
    const { result } = renderHook(() => useImportImageUpload(OWNER));
    await act(async () => {
      await result.current.run(['https://a.example.com/1.png']);
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].status).toBe('uploaded');
    expect(result.current.progress).toEqual({ done: 1, total: 1, url: 'https://a.example.com/1.png' });
  });

  it('cancel aborts the run in flight', async () => {
    let release: () => void = () => {};
    prepareSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(prepared('m1'));
        }),
    );
    const { result } = renderHook(() => useImportImageUpload(OWNER));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run(['https://a.example.com/1.png', 'https://a.example.com/2.png']);
    });
    await waitFor(() => expect(result.current.running).toBe(true));
    act(() => result.current.cancel());
    release();
    await act(async () => {
      await pending;
    });
    expect(result.current.results[1]).toMatchObject({ status: 'failed', reason: 'cancelled' });
  });
});
