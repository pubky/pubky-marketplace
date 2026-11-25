import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW,
  PAYKIT_CREATOR_MAX_IN_FLIGHT,
  PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS,
} from '@/config/paykit-creator';
import { TimeoutErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { NextJsPaykitCreatorService } from './paykit-creator';
import { PaykitCreatorRateLimiter } from './paykit-creator.rate-limit';

const PUBKY = 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';

const mocks = vi.hoisted(() => ({
  getPaykitSetupUrl: vi.fn((): string => 'https://paykit.server/setup'),
}));

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getPaykitSetupUrl: mocks.getPaykitSetupUrl,
}));

// The service reuses answers per creator, so every test asks about a creator of its own.
let creatorCount = 0;
const freshParams = () => ({ creator: `pubky${PUBKY}-${++creatorCount}` });
let params = freshParams();

/** Paykit's `/setup/creator-held` answers, as paykit-server sends them. */
const heldAnswer = (held: boolean) => Response.json({ held }, { headers: { 'Cache-Control': 'no-store' } });
const refused = (status: 429 | 503, retryAfter = status === 429 ? '60' : '1') =>
  Response.json(
    { error: status === 429 ? 'rate_limited' : 'unavailable' },
    { status, headers: { 'Retry-After': retryAfter } },
  );

/** A Paykit read that stays pending until the test ends. */
const hanging: ((response: Response) => void)[] = [];
const hang = () => new Promise<Response>((resolve) => hanging.push(resolve));

describe('NextJsPaykitCreatorService.isCreatorHeld', () => {
  beforeEach(() => {
    params = freshParams();
    PaykitCreatorRateLimiter.resetForTests();
    mocks.getPaykitSetupUrl.mockReturnValue('https://paykit.server/setup');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(async () => {
    // Settle reads a test left pending, so no creator stays in flight for the next test.
    for (const release of hanging.splice(0)) release(heldAnswer(false));
    await Promise.resolve();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([true, false])('asks /setup/creator-held with the creator alone and reads { held: %s }', async (held) => {
    vi.mocked(fetch).mockResolvedValue(heldAnswer(held));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toEqual({ ok: true, held });

    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe('https://paykit.server/setup/creator-held');
    expect([...url.searchParams.entries()]).toEqual([['creator', params.creator]]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
    });
  });

  it.each([
    ['400, a rejected query', () => Response.json({ error: 'invalid_request' }, { status: 400 }), ErrorCategory.Client],
    ['429 at once, without waiting the minute Paykit asks for', () => refused(429), ErrorCategory.RateLimit],
    ['a 503 whose Retry-After is longer than two seconds', () => refused(503, '30'), ErrorCategory.Server],
    ['502', () => new Response('', { status: 502 }), ErrorCategory.Server],
  ])('throws on %s, never reading it as "not held"', async (_label, answer, category) => {
    const response = answer();
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
      category,
      context: expect.objectContaining({ statusCode: response.status }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks once more after a 503 and its one-second Retry-After', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(heldAnswer(true));

    const answer = NextJsPaykitCreatorService.isCreatorHeld(params);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(answer).resolves.toEqual({ ok: true, held: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('charges the retry after a 503 to the window it runs in', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async () => heldAnswer(true));
    // Opens the shared read window.
    await NextJsPaykitCreatorService.isCreatorHeld(freshParams());
    await vi.advanceTimersByTimeAsync(PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS - 500);

    // The first ask runs in this window; its one-second retry lands in the next one.
    vi.mocked(fetch).mockResolvedValueOnce(refused(503));
    const answer = NextJsPaykitCreatorService.isCreatorHeld(params);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(answer).resolves.toEqual({ ok: true, held: true });

    // The next window has already spent one read on that retry.
    for (let i = 1; i < PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW; i += 1) {
      await NextJsPaykitCreatorService.isCreatorHeld(freshParams());
    }
    await expect(NextJsPaykitCreatorService.isCreatorHeld(freshParams())).resolves.toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('throws when the retry after a 503 is refused again', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(refused(503));

    const settled = expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
      context: expect.objectContaining({ statusCode: 503 }),
    });
    await vi.advanceTimersByTimeAsync(1000);

    await settled;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an HTML page', () => new Response('<html></html>', { status: 200 })],
    ['a non-boolean held', () => Response.json({ held: 'yes' })],
  ])('throws on a 200 with %s', async (_label, answer) => {
    vi.mocked(fetch).mockResolvedValue(answer());

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toThrow(
      'Paykit creator-held response is invalid',
    );
  });

  it('throws on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
      category: ErrorCategory.Network,
    });
  });

  it('keeps the creator out of what a network failure logs', async () => {
    const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
      context: expect.objectContaining({ url: 'https://paykit.server/setup/creator-held' }),
    });
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(PUBKY);
  });

  it('reuses a not-held answer for fifteen seconds and a held one for two minutes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(heldAnswer(false))
      .mockImplementation(async () => heldAnswer(true));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toEqual({ ok: true, held: false });
    vi.advanceTimersByTime(14_000);
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toEqual({ ok: true, held: false });
    vi.advanceTimersByTime(2_000);
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toEqual({ ok: true, held: true });
    vi.advanceTimersByTime(119_000);
    await NextJsPaykitCreatorService.isCreatorHeld(params);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2_000);
    await NextJsPaykitCreatorService.isCreatorHeld(params);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not keep a 429, so the next check asks again', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(refused(429)).mockResolvedValueOnce(heldAnswer(true));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toThrow();
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toEqual({ ok: true, held: true });
  });

  it('shares one read between checks that arrive together', async () => {
    vi.mocked(fetch).mockImplementation(async () => heldAnswer(true));

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => NextJsPaykitCreatorService.isCreatorHeld(params)),
    );

    expect(answers).toEqual(Array(5).fill({ ok: true, held: true }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('timeouts', () => {
    const PROBE_TIMEOUT_MS = 6000;

    it('reports a stall before the headers as one timeout, not a network error as well', async () => {
      vi.useFakeTimers();
      const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});
      vi.mocked(fetch).mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      );

      const settled = expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
        category: ErrorCategory.Timeout,
        code: TimeoutErrorCode.REQUEST_TIMEOUT,
      });
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

      await settled;
      expect(logged).toHaveBeenCalledTimes(1);
    });

    it('reports a stall while reading the body as one timeout, not an invalid answer', async () => {
      vi.useFakeTimers();
      const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        const body = new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"held":'));
            init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200 });
      });

      const settled = expect(NextJsPaykitCreatorService.isCreatorHeld(params)).rejects.toMatchObject({
        category: ErrorCategory.Timeout,
        code: TimeoutErrorCode.REQUEST_TIMEOUT,
      });
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

      await settled;
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });

  describe('upstream read limits', () => {
    it('refuses a new creator while too many distinct reads are pending, without asking Paykit', async () => {
      vi.mocked(fetch).mockImplementation(hang);
      const pending = Array.from({ length: PAYKIT_CREATOR_MAX_IN_FLIGHT }, () => freshParams());
      for (const p of pending) void NextJsPaykitCreatorService.isCreatorHeld(p).catch(() => {});
      const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});

      await expect(NextJsPaykitCreatorService.isCreatorHeld(freshParams())).resolves.toEqual({
        ok: false,
        reason: 'rate_limited',
        retryAfterSeconds: 1,
      });
      expect(fetch).toHaveBeenCalledTimes(PAYKIT_CREATOR_MAX_IN_FLIGHT);
      // A local refusal is an expected answer, not an application error: nothing is logged or captured.
      expect(logged).not.toHaveBeenCalled();
    });

    it('still lets a caller join a read already pending when the cap is reached', async () => {
      let release: (response: Response) => void = () => {};
      vi.mocked(fetch)
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
        .mockImplementation(hang);
      const first = NextJsPaykitCreatorService.isCreatorHeld(params);
      for (let i = 1; i < PAYKIT_CREATOR_MAX_IN_FLIGHT; i += 1) {
        void NextJsPaykitCreatorService.isCreatorHeld(freshParams()).catch(() => {});
      }

      const joined = NextJsPaykitCreatorService.isCreatorHeld(params);
      release(heldAnswer(true));

      await expect(Promise.all([first, joined])).resolves.toEqual([
        { ok: true, held: true },
        { ok: true, held: true },
      ]);
    });

    it('stops reading Paykit for the window once the shared read allowance is spent, but still serves kept answers', async () => {
      vi.mocked(fetch).mockImplementation(async () => heldAnswer(true));
      const kept = params;
      await NextJsPaykitCreatorService.isCreatorHeld(kept);
      for (let i = 1; i < PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW; i += 1) {
        await NextJsPaykitCreatorService.isCreatorHeld(freshParams());
      }
      const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});

      await expect(NextJsPaykitCreatorService.isCreatorHeld(freshParams())).resolves.toEqual({
        ok: false,
        reason: 'rate_limited',
        retryAfterSeconds: PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS / 1000,
      });
      expect(logged).not.toHaveBeenCalled();
      await expect(NextJsPaykitCreatorService.isCreatorHeld(kept)).resolves.toEqual({ ok: true, held: true });
      expect(fetch).toHaveBeenCalledTimes(PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW);
    });
  });
});
