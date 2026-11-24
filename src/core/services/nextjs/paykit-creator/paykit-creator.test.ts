import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCategory } from '@/libs/error/error.types';
import { NextJsPaykitCreatorService } from './paykit-creator';

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

describe('NextJsPaykitCreatorService.isCreatorHeld', () => {
  beforeEach(() => {
    params = freshParams();
    mocks.getPaykitSetupUrl.mockReturnValue('https://paykit.server/setup');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([true, false])('asks /setup/creator-held with the creator alone and reads { held: %s }', async (held) => {
    vi.mocked(fetch).mockResolvedValue(heldAnswer(held));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toBe(held);

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

    await expect(answer).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it('reuses a not-held answer for fifteen seconds and a held one for two minutes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(heldAnswer(false))
      .mockImplementation(async () => heldAnswer(true));

    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toBe(false);
    vi.advanceTimersByTime(14_000);
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toBe(false);
    vi.advanceTimersByTime(2_000);
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toBe(true);
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
    await expect(NextJsPaykitCreatorService.isCreatorHeld(params)).resolves.toBe(true);
  });

  it('shares one read between checks that arrive together', async () => {
    vi.mocked(fetch).mockImplementation(async () => heldAnswer(true));

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => NextJsPaykitCreatorService.isCreatorHeld(params)),
    );

    expect(answers).toEqual(Array(5).fill(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
