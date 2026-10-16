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

  it('stops as cancelled, after writing what had loaded, when the caller aborts', async () => {
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
    expect([...run.attached.keys()]).toEqual(['l0', 'l1']);
  });
});

describe('runImportImageBatches recording uploads', () => {
  const withRows = (all: ImportImageTarget[]) =>
    all.map((entry) => ({ ...entry, rowIdentity: `row-${entry.listingId}` }));

  /** Calls onPrepared for each photo, as the real upload does just before it writes the file. */
  const recordingUpload =
    (written: string[]): Upload =>
    async ({ urls, onPrepared, onResult }: TImportImageRunParams) => {
      for (const url of urls) {
        await onPrepared?.(url, media(url));
        written.push(url);
        onResult?.(uploaded(url));
      }
      return { results: urls.map((url) => uploaded(url)), fetchedBytes: 0 };
    };

  it('records each photo on the first row of the listing that needs it, before the file is written', async () => {
    const all = withRows(listings(2, 2));
    const run = host(all);
    const events: string[] = [];
    const written: string[] = [];
    const upload = recordingUpload(written);
    await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      journal: async (row, url) => {
        events.push(`record ${row} ${url.split('.example.com/')[1]} (written so far: ${written.length})`);
      },
      upload,
    });
    expect(events).toEqual([
      'record row-l0 0/0.jpg (written so far: 0)',
      'record row-l0 0/1.jpg (written so far: 1)',
      'record row-l1 1/0.jpg (written so far: 2)',
      'record row-l1 1/1.jpg (written so far: 3)',
    ]);
  });

  it('records a photo shared by two listings once, on the first listing that needs it, and on a normalised URL', async () => {
    const shared = 'https://shop.example.com/shared.jpg';
    const all = withRows([
      { listingId: 'first', images: [{ url: ` ${shared} `, alt: 'a' }] },
      { listingId: 'second', images: [{ url: shared, alt: 'b' }] },
    ]);
    const run = host(all);
    const journal = vi.fn(async () => undefined);
    await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      journal,
      upload: recordingUpload([]),
    });
    expect(journal).toHaveBeenCalledTimes(1);
    expect(journal).toHaveBeenCalledWith('row-first', shared, expect.anything());
  });

  it('records nothing for a listing that has no row to keep the record on, and does not fail', async () => {
    const run = host(listings(1, 1));
    const journal = vi.fn(async () => undefined);
    const result = await runImportImageBatches({
      ownerPubky: OWNER,
      loadTargets: run.loadTargets,
      attach: run.attach,
      journal,
      upload: recordingUpload([]),
    });
    expect(result.status).toBe('complete');
    expect(journal).not.toHaveBeenCalled();
  });

  it('stops the run, before the file is written, when a record cannot be kept', async () => {
    const written: string[] = [];
    const run = host(withRows(listings(2, 2)));
    await expect(
      runImportImageBatches({
        ownerPubky: OWNER,
        loadTargets: run.loadTargets,
        attach: run.attach,
        journal: async () => {
          throw new Error('storage unavailable');
        },
        upload: recordingUpload(written),
      }),
    ).rejects.toThrow('storage unavailable');
    expect(written).toEqual([]);
  });
});

describe('runImportImageBatches writing as it goes', () => {
  /** A host whose rows keep what was attached, with a partial listing still counting as not done. */
  function persisting(all: ImportImageTarget[]) {
    const rows = new Map<string, ListingImageOutcome>();
    const log: string[] = [];
    const uploads: string[][] = [];
    return {
      rows,
      log,
      uploads,
      loadTargets: async () => all.filter((entry) => !rows.has(entry.listingId) || rows.get(entry.listingId)?.partial),
      knownMedia: async (urls: string[]) => {
        const known = new Map<string, PresetJson>();
        for (const outcome of rows.values()) {
          const loaded = outcome.results.filter((entry) => entry.status === 'uploaded');
          loaded.forEach((entry, index) => {
            if (urls.includes(entry.url)) known.set(entry.url, outcome.media[index] as PresetJson);
          });
        }
        return known;
      },
      attach: async (outcomes: ListingImageOutcome[]) => {
        for (const outcome of outcomes) {
          rows.set(outcome.listingId, outcome);
          log.push(`${outcome.partial ? 'partial' : 'done'} ${outcome.listingId}`);
        }
      },
      /** Answers one photo at a time through onResult, as the real run does. */
      upload: (stopAfter?: { photos: number; controller: AbortController }): Upload =>
        vi.fn(async ({ urls, onResult, signal }: TImportImageRunParams) => {
          uploads.push([...urls]);
          const results: TImportImageResult[] = [];
          for (const [index, url] of urls.entries()) {
            const entry = signal?.aborted ? failed(url, 'cancelled') : uploaded(url);
            results.push(entry);
            if (entry.status === 'uploaded') onResult?.(entry);
            if (stopAfter && index + 1 === stopAfter.photos) stopAfter.controller.abort();
          }
          return { results, fetchedBytes: 0 };
        }),
    };
  }

  it('writes each listing as soon as its last photo has loaded, not when the batch ends', async () => {
    const run = persisting(listings(3, 2));
    const events: string[] = [];
    const upload: Upload = vi.fn(async ({ urls, onResult }: TImportImageRunParams) => {
      for (const url of urls) {
        onResult?.(uploaded(url));
        await Promise.resolve();
        await Promise.resolve();
        events.push(`loaded ${url.split('.example.com/')[1]} after ${run.log.join(',') || 'nothing written'}`);
      }
      return { results: urls.map((url) => uploaded(url)), fetchedBytes: 0 };
    });
    await runImportImageBatches({ ownerPubky: OWNER, ...run, upload });
    expect(events).toEqual([
      'loaded 0/0.jpg after nothing written',
      'loaded 0/1.jpg after done l0',
      'loaded 1/0.jpg after done l0',
      'loaded 1/1.jpg after done l0,done l1',
      'loaded 2/0.jpg after done l0,done l1',
      'loaded 2/1.jpg after done l0,done l1,done l2',
    ]);
  });

  it('on a close in the middle of a listing, writes the finished listings and the photos of the one under way as partial', async () => {
    const all = listings(3, 3);
    const run = persisting(all);
    const controller = new AbortController();
    const result = await runImportImageBatches({
      ownerPubky: OWNER,
      ...run,
      upload: run.upload({ photos: 5, controller }),
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
    expect(run.log).toEqual(['done l0', 'partial l1']);
    expect(run.rows.get('l1')?.media).toHaveLength(2);
    expect(run.rows.get('l1')?.results.map((entry) => entry.status)).toEqual(['uploaded', 'uploaded']);
    expect(run.rows.has('l2')).toBe(false);
  });

  it('resumes a listing that was partly loaded by loading only the photos it lacks', async () => {
    const all = listings(3, 3);
    const run = persisting(all);
    const controller = new AbortController();
    await runImportImageBatches({
      ownerPubky: OWNER,
      ...run,
      upload: run.upload({ photos: 5, controller }),
      signal: controller.signal,
    });
    run.uploads.length = 0;

    const resumed = await runImportImageBatches({ ownerPubky: OWNER, ...run, upload: run.upload() });
    expect(resumed.status).toBe('complete');
    expect(run.uploads).toEqual([
      [
        'https://shop.example.com/1/2.jpg',
        'https://shop.example.com/2/0.jpg',
        'https://shop.example.com/2/1.jpg',
        'https://shop.example.com/2/2.jpg',
      ],
    ]);
    expect(run.rows.get('l1')?.partial).toBeUndefined();
    expect(run.rows.get('l1')?.media).toHaveLength(3);
    expect(run.rows.get('l2')?.media).toHaveLength(3);
  });

  it('writes a partly loaded listing as partial when a batch ends with some of its photos deferred', async () => {
    const run = persisting([target(0, 2)]);
    const upload: Upload = vi.fn(async ({ urls, onResult }: TImportImageRunParams) => {
      const results = urls.map((url) => (url.endsWith('/1.jpg') ? failed(url, 'budget_exceeded') : uploaded(url)));
      for (const entry of results) if (entry.status === 'uploaded') onResult?.(entry);
      return { results, fetchedBytes: 0 };
    });
    const result = await runImportImageBatches({ ownerPubky: OWNER, ...run, upload });
    expect(result.status).toBe('interrupted');
    expect(run.log).toEqual(['partial l0']);
    expect(run.rows.get('l0')?.media).toHaveLength(1);
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
