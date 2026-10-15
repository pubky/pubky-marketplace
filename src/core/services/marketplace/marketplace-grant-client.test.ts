import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Err } from '@/libs/error/error.factories';
import captured from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import { setBasePath } from '@/test-utils/base-path';
import {
  beginMarketplaceGrantFlow,
  clearMarketplaceBffSession,
  clearMarketplaceBffSessionConfirmed,
  pairMarketplaceBffSession,
} from './marketplace-grant-client';

const STATE_ID = '11111111-1111-4111-8111-111111111111';

type CapturedRequest = { scheme: string; host: string; params: string[]; caps: string; cid: string };

function urlFor(request: CapturedRequest, caps = request.caps): string {
  const values: Record<string, string> = {
    caps,
    relay: 'https://relay.example/inbox',
    secret: 's',
    cid: request.cid,
    cpk: 'k',
  };
  return `${request.scheme}//${request.host}?${request.params
    .map((name) => `${name}=${encodeURIComponent(values[name])}`)
    .join('&')}`;
}

function created(authorizationUrl: string): Response {
  return new Response(
    JSON.stringify({
      authorization_url: authorizationUrl,
      expires_at: new Date(Date.now() + 120_000).toISOString(),
      state_id: STATE_ID,
      status: 'awaiting',
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
}

describe('marketplace reconnect grant client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    setBasePath('');
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('confirms one BFF deletion under the mounted path', async () => {
    setBasePath('/shop-embed');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await clearMarketplaceBffSessionConfirmed();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/shop-embed/api/marketplace/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([404, 503])('does not confirm cleanup after an HTTP %s', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(clearMarketplaceBffSessionConfirmed()).rejects.toThrow('marketplace_session_clear_failed');
  });

  it('does not confirm cleanup after a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(clearMarketplaceBffSessionConfirmed()).rejects.toThrow('marketplace_session_clear_failed');
  });

  it('aborts a stalled cleanup and leaves confirmation unsuccessful', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const failure = expect(clearMarketplaceBffSessionConfirmed()).rejects.toThrow('marketplace_session_clear_failed');

    await vi.advanceTimersByTimeAsync(4_000);

    await failure;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the mount prefix for pairing, reconnect, polling, cancellation and unpairing', async () => {
    setBasePath('/shop-embed');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(created(urlFor(captured.parity_request)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await pairMarketplaceBffSession({ token: 'token', pubky: 'pubky', sessionId: STATE_ID });
    const flow = await beginMarketplaceGrantFlow();
    await flow.awaitResult();
    await flow.cancel();
    await clearMarketplaceBffSession(STATE_ID);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/shop-embed/api/marketplace/session',
      '/shop-embed/api/marketplace/grant-flows',
      `/shop-embed/api/marketplace/grant-flows/${STATE_ID}/status`,
      `/shop-embed/api/marketplace/grant-flows/${STATE_ID}/cancel`,
      `/shop-embed/api/marketplace/session?session_id=${STATE_ID}`,
    ]);
    expect(fetchMock.mock.calls.every(([, options]) => options?.credentials === 'same-origin')).toBe(true);
  });

  it.each([
    ['the /priv parity grant', captured.parity_request],
    ['the previous service grant', captured.previous_request],
  ])('shows %s to the signer', async (_label, request) => {
    const url = urlFor(request);
    fetchMock.mockResolvedValueOnce(created(url));

    const flow = await beginMarketplaceGrantFlow();

    expect(flow.authorizationUrl).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the Shop sign-in grant', captured.shop_signin_request.caps],
    ['homeserver root', '/:rw'],
    ['an extra tree', `${captured.parity_request.caps},/pub/paykit/:rw`],
  ])('cancels instead of showing a QR that asks for %s', async (_label, caps) => {
    fetchMock
      .mockResolvedValueOnce(created(urlFor(captured.parity_request, caps)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(beginMarketplaceGrantFlow()).rejects.toThrow('result_denied');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/marketplace/grant-flows',
      `/api/marketplace/grant-flows/${STATE_ID}/cancel`,
    ]);
  });
});

it('treats a missing BFF cookie as expected bootstrap control flow without Sentry', async () => {
  const report = vi.spyOn(Err, 'server');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'shop_session_missing' }), { status: 401 })),
  );
  await expect(beginMarketplaceGrantFlow()).rejects.toThrow('shop_session_missing');
  expect(report).not.toHaveBeenCalled();
  report.mockRestore();
  vi.unstubAllGlobals();
});
