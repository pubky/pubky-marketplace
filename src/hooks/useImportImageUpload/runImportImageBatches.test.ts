import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TImportImagePrepareResult } from '@/application/import-image/import-image-upload';
import { IMPORT_IMAGE_MAX_COUNT } from '@/config/import-image';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import type { ImportImageTarget, ListingImageOutcome } from '@/pipes/commerce/import-image-phase';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import { asOpaque } from '@/test-utils/type-assertions';
import { runImportImageBatches, type TImageBatchProgress } from './runImportImageBatches';
import type { TImportImageResult, TImportImageRunParams, uploadImportImages } from './useImportImageUpload';

const OWNER = 'o'.repeat(52);

const target = (index: number, photos = 5): ImportImageTarget => ({
  listingId: `l${index}`,
  images: Array.from({ length: photos }, (_, photo) => ({
    url: `https://shop.example.com/${index}/${photo}.jpg`,
    alt: `Listing ${index}`,
  })),
});
const listings = (count: number, photos = 5) => Array.from({ length: count }, (_, index) => target(index, photos));

const media = (url: string) =>
  asOpaque<NonNullable<TImportImageResult['media']>>({ id: `m-${url.split('/').slice(-2).join('-')}`, altText: 'x' });
const uploaded = (url: string): TImportImageResult => ({ url, status: 'uploaded', media: media(url) });
const failed = (url: string, reason: NonNullable<TImportImageResult['reason']>): TImportImageResult => ({
  url,
  status: 'failed',
  reason,
});

type Upload = typeof uploadImportImages;

/** A host that keeps what was attached, as the planned rows do, so a resume loads only what is left. */
function host(all: ImportImageTarget[], answer: (url: string, call: number) => TImportImageResult = uploaded) {
  const attached = new Map<string, ListingImageOutcome>();
  const uploads: string[][] = [];
  const upload: Upload = vi.fn(async ({ urls }: TImportImageRunParams) => {
    uploads.push([...urls]);
    return { results: urls.map((url) => answer(url, uploads.length)), fetchedBytes: 0 };
  });
  return {
    attached,
    uploads,
    upload,
    loadTargets: async () => all.filter((entry) => !attached.has(entry.listingId)),
    attach: async (outcomes: ListingImageOutcome[]) => {
      for (const outcome of outcomes) attached.set(outcome.listingId, outcome);
    },
  };
}

describe('runImportImageBatches', () => {
  it('does nothing, and says complete, when no listing needs photos', async () => {
    const run = host([]);
    expect(await runImportImageBatches({ ownerPubky: OWNER, ...run })).toEqual({
      status: 'complete',
      remaining: 0,
      done: 0,
      total: 0,
    });
    expect(run.upload).not.toHaveBeenCalled();
  });

  it('loads 725 photos in two batches, 500 and then 225, each written to the rows when it ends', async () => {
    const all = listings(145);
    const run = host(all);
    const progress: TImageBatchProgress[] = [];
    const attachOrder: number[] = [];
    const attach = vi.fn(async (outcomes: ListingImageOutcome[]) => {
      attachOrder.push(outcomes.length);
      await run.attach(outcomes);
    });

    const result = await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach,
      upload: run.upload,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result).toEqual({ status: 'complete', remaining: 0, done: 725, total: 725 });
    expect(run.uploads.map((urls) => urls.length)).toEqual([IMPORT_IMAGE_MAX_COUNT, 225]);
    expect(attachOrder).toEqual([100, 45]);
    expect(new Set(run.uploads.flat()).size).toBe(725);
    expect(run.attached.size).toBe(145);
    expect(progress.at(0)).toMatchObject({ done: 0, total: 725, batch: 1, batches: 2 });
    expect(progress.some((entry) => entry.batch === 2 && entry.batches === 2)).toBe(true);
    expect(progress.at(-1)).toEqual({ done: 725, total: 725, batch: 2, batches: 2 });
    expect(progress.every((entry) => entry.done <= entry.total)).toBe(true);
  });

  it('passes each batch the alt text of its own listings', async () => {
    const run = host(listings(2, 1));
    await runImportImageBatches({ ownerPubky: OWNER, ...run });
    const { altText } = vi.mocked(run.upload).mock.calls[0]?.[0] as TImportImageRunParams;
    expect(altText?.('https://shop.example.com/1/0.jpg', 0)).toBe('Listing 1');
  });

  describe('an interruption and a resume', () => {
    it('picks up at the next batch: listings written to the rows are skipped and no photo is loaded twice', async () => {
      const all = listings(145);
      const run = host(all);
      const controller = new AbortController();
      const attach = async (outcomes: ListingImageOutcome[]) => {
        await run.attach(outcomes);
        controller.abort();
      };

      const first = await runImportImageBatches({
        ownerPubky: OWNER,
        loadTargets: run.loadTargets,
        attach,
        upload: run.upload,
        signal: controller.signal,
      });
      expect(first).toMatchObject({ status: 'cancelled', remaining: 45 });
      expect(run.attached.size).toBe(100);
      expect(run.uploads.map((urls) => urls.length)).toEqual([500]);

      const second = await runImportImageBatches({ ownerPubky: OWNER, ...run });
      expect(second).toEqual({ status: 'complete', remaining: 0, done: 225, total: 225 });
      expect(run.uploads.map((urls) => urls.length)).toEqual([500, 225]);
      expect(new Set(run.uploads.flat()).size).toBe(725);
      expect(run.attached.size).toBe(145);
    });

    it('resumes after a failure to write a batch: the batch that was not written is loaded again, the earlier ones are not', async () => {
      const all = listings(145);
      const run = host(all);
      let writes = 0;
      const attach = async (outcomes: ListingImageOutcome[]) => {
        writes += 1;
        if (writes === 2) throw new Error('disk full');
        await run.attach(outcomes);
      };
      await expect(
        runImportImageBatches({ ownerPubky: OWNER, loadTargets: run.loadTargets, attach, upload: run.upload }),
      ).rejects.toThrow('disk full');
      expect(run.attached.size).toBe(100);

      await runImportImageBatches({ ownerPubky: OWNER, ...run });
      expect(run.uploads.map((urls) => urls.length)).toEqual([500, 225, 225]);
      expect(run.attached.size).toBe(145);
    });
  });

  describe('photos that failed only because the run ran out of budget', () => {
    it('are loaded in a later batch, and a photo already loaded for the same listing is reused, not loaded again', async () => {
      const all = [target(0, 2), target(1, 2), target(2, 2)];
      const run = host(all, (url, call) =>
        call === 1 && (url.endsWith('/1/1.jpg') || url.endsWith('/2/0.jpg') || url.endsWith('/2/1.jpg'))
          ? failed(url, 'budget_exceeded')
          : uploaded(url),
      );
      const progress: TImageBatchProgress[] = [];
      const result = await runImportImageBatches({
        ownerPubky: OWNER,
        ...run,
        onProgress: (entry) => progress.push(entry),
      });

      expect(result).toMatchObject({ status: 'complete', done: 6, total: 6 });
      expect(run.uploads).toEqual([
        all.flatMap((entry) => entry.images.map((image) => image.url)),
        ['https://shop.example.com/1/1.jpg', 'https://shop.example.com/2/0.jpg', 'https://shop.example.com/2/1.jpg'],
      ]);
      expect([...run.attached.keys()]).toEqual(['l0', 'l1', 'l2']);
      expect(run.attached.get('l1')?.media).toHaveLength(2);
      expect(run.attached.get('l2')?.results.map((entry) => entry.status)).toEqual(['uploaded', 'uploaded']);
      expect(progress.at(-1)).toMatchObject({ done: 6, total: 6, batch: 2, batches: 2 });
    });

    it('are not counted as the listing failing: none of its results is a failure', async () => {
      const run = host([target(0, 2)], (url, call) =>
        call === 1 && url.endsWith('/0.jpg') ? failed(url, 'limit_reached') : uploaded(url),
      );
      await runImportImageBatches({ ownerPubky: OWNER, ...run });
      expect(run.attached.get('l0')?.results.map((entry) => entry.status)).toEqual(['uploaded', 'uploaded']);
    });
  });

  describe('photos that failed for their own reason', () => {
    it('are final: the listing keeps the photos that loaded, the failure is recorded, and nothing is retried', async () => {
      const all = [target(0, 3)];
      const run = host(all, (url) => (url.endsWith('/1.jpg') ? failed(url, 'not_image') : uploaded(url)));
      const result = await runImportImageBatches({ ownerPubky: OWNER, ...run });
      expect(result.status).toBe('complete');
      expect(run.uploads).toHaveLength(1);
      const outcome = run.attached.get('l0');
      expect(outcome?.media).toHaveLength(2);
      expect(outcome?.results.map((entry) => [entry.status, entry.reason])).toEqual([
        ['uploaded', undefined],
        ['failed', 'not_image'],
        ['uploaded', undefined],
      ]);
    });

    it('leave a listing with no photo at all on its rows with their reasons, for the publish to fail as photo required', async () => {
      const run = host([target(0, 2)], (url) => failed(url, 'blocked_address'));
      expect((await runImportImageBatches({ ownerPubky: OWNER, ...run })).status).toBe('complete');
      const outcome = run.attached.get('l0');
      expect(outcome?.media).toEqual([]);
      expect(outcome?.results.map((entry) => entry.reason)).toEqual(['blocked_address', 'blocked_address']);
    });
  });

  it('stops as interrupted, writing nothing for the listings it could not do, when the route will not serve more', async () => {
    const all = listings(3, 2);
    const run = host(all, (url) => failed(url, 'rate_limited'));
    const result = await runImportImageBatches({ ownerPubky: OWNER, ...run });
    expect(result).toEqual({ status: 'interrupted', remaining: 3, done: 0, total: 6 });
    expect(run.attached.size).toBe(0);
    expect(run.uploads).toHaveLength(1);
  });

  it('writes the listings it finished before it was interrupted, and leaves the rest for the resume', async () => {
    const all = listings(4, 1);
    const run = host(all, (url) =>
      url.includes('/2/') || url.includes('/3/') ? failed(url, 'rate_limited') : uploaded(url),
    );
    const result = await runImportImageBatches({ ownerPubky: OWNER, ...run });
    expect(result).toMatchObject({ status: 'interrupted', remaining: 2, done: 2, total: 4 });
    expect([...run.attached.keys()]).toEqual(['l0', 'l1']);

    const resumed = host(all, uploaded);
    for (const [id, outcome] of run.attached) resumed.attached.set(id, outcome);
    expect(await runImportImageBatches({ ownerPubky: OWNER, ...resumed })).toMatchObject({
      status: 'complete',
      done: 2,
    });
    expect(resumed.uploads).toEqual([['https://shop.example.com/2/0.jpg', 'https://shop.example.com/3/0.jpg']]);
  });

  it('loads a photo shared by listings in different batches once', async () => {
    const shared = 'https://shop.example.com/shared.jpg';
    const first = { listingId: 'first', images: [{ url: shared, alt: 'a' }, ...target(1, 499).images] };
    const second = { listingId: 'second', images: [{ url: shared, alt: 'b' }, ...target(2, 3).images] };
    const run = host([first, second]);
    await runImportImageBatches({ ownerPubky: OWNER, ...run });
    expect(run.uploads).toHaveLength(2);
    expect(run.uploads.flat().filter((url) => url === shared)).toHaveLength(1);
    expect(run.attached.get('second')?.media).toHaveLength(4);
  });

  it('reuses a photo already stored on another listing of the import instead of loading it again', async () => {
    const shared = 'https://shop.example.com/shared.jpg';
    const all = [{ listingId: 'late', images: [{ url: shared, alt: 'x' }, ...target(7, 1).images] }];
    const run = host(all);
    const known = vi.fn(
      async (urls: string[]): Promise<ReadonlyMap<string, PresetJson>> =>
        new Map(urls.filter((url) => url === shared).map((url) => [url, { id: 'stored', altText: 'x' }])),
    );
    const result = await runImportImageBatches({ ownerPubky: OWNER, ...run, knownMedia: known });
    expect(known).toHaveBeenCalledWith([shared, 'https://shop.example.com/7/0.jpg']);
    expect(run.uploads).toEqual([['https://shop.example.com/7/0.jpg']]);
    expect(result).toMatchObject({ status: 'complete', done: 2, total: 2 });
    expect(run.attached.get('late')?.media).toHaveLength(2);
  });

  it('writes a listing whose photos are unchanged, which has nothing to load, with its batch', async () => {
    const unchanged: ImportImageTarget = { listingId: 'kept', images: [], keptMedia: [] };
    const run = host([unchanged, target(1, 2)]);
    await runImportImageBatches({ ownerPubky: OWNER, ...run });
    expect([...run.attached.keys()]).toEqual(['kept', 'l1']);
  });

  it('stops as cancelled without writing the batch in flight when the caller aborts', async () => {
    const controller = new AbortController();
    const run = host(listings(2, 1));
    const upload: Upload = async (params) => {
      controller.abort();
      return run.upload(params);
    };
    const result = await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      upload,
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
    expect(run.attached.size).toBe(0);
  });
});

describe('runImportImageBatches waiting on the route', () => {
  const prepareSpy = vi.spyOn(ImportImageUploadController, 'fetchAndPrepare');
  const writeSpy = vi.spyOn(CommerceController, 'commitCreateMedia');
  const prepared = (url: string): TImportImagePrepareResult => ({
    ok: true,
    fetchedBytes: 100,
    bytes: new Uint8Array([1]),
    media: asOpaque<Extract<TImportImagePrepareResult, { ok: true }>['media']>({ id: `m-${url}`, altText: 'x' }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    writeSpy.mockResolvedValue('pubky://ok');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for Retry-After in the middle of a run, shows the wait, then continues with the same photo and loads none twice', async () => {
    const all = listings(4, 1);
    const run = host(all);
    const fetchedUrls: string[] = [];
    let limited = false;
    prepareSpy.mockImplementation(async ({ url }) => {
      if (url.endsWith('/2/0.jpg') && !limited) {
        limited = true;
        return { ok: false, reason: 'rate_limited', fetchedBytes: 0, retryAfterSeconds: 4 };
      }
      fetchedUrls.push(url);
      return prepared(url);
    });
    const waits: (number | null)[] = [];

    const { uploadImportImages: realUpload } = await import('./useImportImageUpload');
    const pending = runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      upload: realUpload,
      onWait: (seconds) => waits.push(seconds),
    });
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await pending;

    expect(result).toMatchObject({ status: 'complete', done: 4, total: 4 });
    expect(waits).toEqual([4, 3, 2, 1, null]);
    expect(fetchedUrls).toEqual(all.flatMap((entry) => entry.images.map((image) => image.url)));
    expect([...run.attached.keys()]).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(run.attached.get('l2')?.results).toEqual([{ url: 'https://shop.example.com/2/0.jpg', status: 'uploaded' }]);
  });

  it('keeps going across batches after a wait, and stops as interrupted when the route never opens up', async () => {
    const all = listings(4, 1);
    const run = host(all);
    prepareSpy.mockImplementation(async () => ({
      ok: false,
      reason: 'rate_limited',
      fetchedBytes: 0,
      retryAfterSeconds: 9_999,
    }));
    const { uploadImportImages: realUpload } = await import('./useImportImageUpload');
    const result = await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      upload: realUpload,
    });
    expect(result).toMatchObject({ status: 'interrupted', remaining: 4 });
    expect(run.attached.size).toBe(0);
  });
});
