// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import { createStoreStateResolver, resetStoreStateForTests, resolveStoreState } from './store-state.server';

const runtime = vi.hoisted(() => ({
  seller: undefined as string | undefined,
  mode: undefined as 'single_seller' | undefined,
  serviceUrl: 'https://service.example',
}));

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getMarketplaceServiceUrl: () => runtime.serviceUrl,
  getStoreMode: () => runtime.mode,
  getStoreSeller: () => runtime.seller,
}));
vi.mock('@/libs/logger/logger', () => ({ Logger: { warn: vi.fn() } }));

const SELLER = 'o'.repeat(52);
const OTHER_SELLER = 'y'.repeat(52);
const UNCLAIMED_BODY = { mode: 'single_seller', state: 'unclaimed', seller: null };
const CLAIMED_BODY = { mode: 'single_seller', state: 'claimed', seller: SELLER };
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockService(body: unknown, status = 200): void {
  fetchMock.mockImplementation(async () => jsonResponse(body, status));
}

describe('resolveStoreState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStoreStateForTests();
    runtime.seller = undefined;
    runtime.mode = 'single_seller';
    runtime.serviceUrl = 'https://service.example';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(Logger.warn).mockClear();
  });

  afterEach(() => {
    resetStoreStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns off without a service read', async () => {
    runtime.mode = undefined;
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'off' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a pinned seller without a service read', async () => {
    runtime.seller = SELLER;
    await expect(resolveStoreState()).resolves.toEqual({
      kind: 'claimed',
      seller: SELLER,
      source: 'pinned',
      claimMode: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the service base, no-store and a two second timeout', async () => {
    mockService(UNCLAIMED_BODY);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledWith('https://service.example/v1/store', {
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    { name: 'unclaimed', body: UNCLAIMED_BODY, ttl: 2_000 },
    { name: 'claimed', body: CLAIMED_BODY, ttl: 600_000 },
    { name: 'unavailable', body: {}, ttl: 1_000, status: 503 },
  ])('caches $name for its TTL', async ({ body, ttl, status }) => {
    mockService(body, status);
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(ttl - 1);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([404, 429, 500, 503])('maps HTTP %s to unavailable', async (status) => {
    mockService(UNCLAIMED_BODY, status);
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });
  });

  it('maps a network error to unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });
  });

  it('maps a timeout to unavailable', async () => {
    fetchMock.mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = resolveStoreState();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ kind: 'unavailable', claimMode: true });
  });

  it.each([
    ['unparseable', '{'],
    ['claimed with a null seller', { mode: 'single_seller', state: 'claimed', seller: null }],
    ['unclaimed with a seller', { mode: 'single_seller', state: 'unclaimed', seller: SELLER }],
    ['marketplace mode', { mode: 'marketplace', state: 'unclaimed', seller: null }],
    ['an invalid seller', { mode: 'single_seller', state: 'claimed', seller: 'not-a-pubky' }],
  ])('maps %s to unavailable', async (_name, body) => {
    mockService(body);
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });
  });

  it('shares one in-flight read between concurrent callers', async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(
      async () =>
        await new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(UNCLAIMED_BODY));
        }),
    );
    const reads = Array.from({ length: 8 }, () => resolveStoreState());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all(reads);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets fresh bypass a live unclaimed cache only once the last upstream read is two seconds old', async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      async () =>
        await new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(UNCLAIMED_BODY));
        }),
    );
    const slowRead = resolveStoreState();
    await vi.advanceTimersByTimeAsync(1_500);
    release?.();
    await slowRead;
    mockService(UNCLAIMED_BODY);

    await resolveStoreState({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await resolveStoreState({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps alternating plain and forced reads to one upstream read per two seconds', async () => {
    const readTimes: number[] = [];
    fetchMock.mockImplementation(async () => {
      readTimes.push(Date.now());
      return jsonResponse(UNCLAIMED_BODY);
    });

    for (let tick = 0; tick < 60; tick += 1) {
      await resolveStoreState({ fresh: tick % 2 === 1 });
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(readTimes).toHaveLength(3);
    for (let read = 1; read < readTimes.length; read += 1) {
      expect(readTimes[read] - readTimes[read - 1]).toBeGreaterThanOrEqual(2_000);
    }
  });

  it('backs off for two seconds after a rate-limited read', async () => {
    mockService({}, 429);
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });

    for (let tick = 0; tick < 19; tick += 1) {
      await vi.advanceTimersByTimeAsync(100);
      await resolveStoreState({ fresh: tick % 2 === 0 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { retryAfter: '5', backoffMs: 5_000 },
    { retryAfter: '600', backoffMs: 10_000 },
    { retryAfter: '0', backoffMs: 2_000 },
  ])('honours Retry-After $retryAfter within the backoff bounds', async ({ retryAfter, backoffMs }) => {
    fetchMock.mockImplementation(
      async () => new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } }),
    );
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(backoffMs - 1);
    await resolveStoreState({ fresh: true });
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours a bounded Retry-After on an unavailable service answer', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503, headers: { 'Retry-After': '4' } }));
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(3_999);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares the default resolver across module instances through globalThis', async () => {
    mockService(UNCLAIMED_BODY);
    await resolveStoreState();
    vi.resetModules();
    const second = await import('./store-state.server');
    await second.resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a created resolver isolated from the default one', async () => {
    mockService(UNCLAIMED_BODY);
    await resolveStoreState();
    const isolated = createStoreStateResolver();
    await isolated.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds sequential forced reads to one per unclaimed TTL window', async () => {
    mockService(UNCLAIMED_BODY);

    for (let request = 0; request < 20; request += 1) {
      await expect(resolveStoreState({ fresh: true })).resolves.toEqual({ kind: 'unclaimed', claimMode: true });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    for (let request = 0; request < 20; request += 1) {
      await resolveStoreState({ fresh: true });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a forced loop turn rate limiting into unavailable', async () => {
    mockService(UNCLAIMED_BODY);

    for (let request = 0; request < 40; request += 1) {
      if (request === 20) await vi.advanceTimersByTimeAsync(2_000);
      await expect(resolveStoreState({ fresh: true })).resolves.toEqual({ kind: 'unclaimed', claimMode: true });
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  it('stops reading a valid store body one byte past the limit', async () => {
    const limit = 64 * 1_024;
    const empty = JSON.stringify({ ...UNCLAIMED_BODY, padding: '' });
    const body = JSON.stringify({ ...UNCLAIMED_BODY, padding: 'x'.repeat(limit + 1 - empty.length) });
    expect(new TextEncoder().encode(body).byteLength).toBe(limit + 1);
    mockService(body);

    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });
    expect(Logger.warn).toHaveBeenCalledWith('[store-state] Store state read failed', { reason: 'body_too_large' });
  });

  it('accepts a valid store body exactly at the limit', async () => {
    const limit = 64 * 1_024;
    const empty = JSON.stringify({ ...UNCLAIMED_BODY, padding: '' });
    mockService(JSON.stringify({ ...UNCLAIMED_BODY, padding: 'x'.repeat(limit - empty.length) }));

    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unclaimed', claimMode: true });
  });

  it('ignores fresh once claimed', async () => {
    mockService(CLAIMED_BODY);
    await resolveStoreState();
    await resolveStoreState({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a claimed state through a failed revalidation and logs once', async () => {
    mockService(CLAIMED_BODY);
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(600_000);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(resolveStoreState()).resolves.toEqual({
      kind: 'claimed',
      seller: SELLER,
      source: 'claim',
      claimMode: true,
    });
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    await resolveStoreState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a claimed state through a contradictory revalidation', async () => {
    mockService(CLAIMED_BODY);
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(600_000);
    mockService({ mode: 'single_seller', state: 'claimed', seller: null });
    await expect(resolveStoreState()).resolves.toMatchObject({ kind: 'claimed', seller: SELLER });
  });

  it('adopts and logs a different authoritative seller', async () => {
    mockService(CLAIMED_BODY);
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(600_000);
    mockService({ ...CLAIMED_BODY, seller: OTHER_SELLER });
    await expect(resolveStoreState()).resolves.toEqual({
      kind: 'claimed',
      seller: OTHER_SELLER,
      source: 'claim',
      claimMode: true,
    });
    expect(Logger.warn).toHaveBeenCalledWith('[store-state] Claimed seller changed', {
      previous: SELLER.slice(0, 8),
      current: OTHER_SELLER.slice(0, 8),
    });
  });

  it('adopts authoritative unclaimed instead of resurrecting stale claimed', async () => {
    mockService(CLAIMED_BODY);
    await resolveStoreState();
    await vi.advanceTimersByTimeAsync(600_000);
    mockService(UNCLAIMED_BODY);
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unclaimed', claimMode: true });
    await vi.advanceTimersByTimeAsync(2_000);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(resolveStoreState()).resolves.toEqual({ kind: 'unavailable', claimMode: true });
  });
});
