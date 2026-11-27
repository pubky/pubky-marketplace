import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceSessionService } from './marketplace-session';
import { MarketplaceStoreClaimService } from './marketplace-store-claim';

vi.mock('@/config/commerce', async (original) => ({
  ...(await original<typeof import('@/config/commerce')>()),
  getMarketplaceUrl: () => 'https://svc.example',
}));

const PUBKY = 'o'.repeat(52);
const CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('MarketplaceStoreClaimService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(MarketplaceSessionService, 'getActiveSession').mockReturnValue({
      token: 'bearer-token',
      pubky: PUBKY,
      capabilities: '',
      expiresAtMs: Date.now() + 60_000,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts only the normalized code with the marketplace bearer', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true }));

    await expect(MarketplaceStoreClaimService.claim(CODE.toLowerCase(), PUBKY)).resolves.toEqual({ kind: 'success' });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://svc.example/v1/store/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer bearer-token', 'content-type': 'application/json' },
      body: JSON.stringify({ claim_code: CODE }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
    });
  });

  it.each([
    ['claim_code_invalid', 'invalid-code'],
    ['claim_session_stale', 'stale-session'],
    ['claim_session_source', 'session-source'],
    ['claim_session_capability', 'session-capability'],
  ] as const)('maps %s', async (reason, kind) => {
    fetchMock.mockResolvedValue(
      respond(403, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authorized.', reason } }),
    );
    await expect(MarketplaceStoreClaimService.claim(CODE, PUBKY)).resolves.toEqual({ kind });
  });

  it('maps a rejected bearer separately from a service failure', async () => {
    fetchMock.mockResolvedValue(respond(401, { ok: false, error: { code: 'UNAUTHORIZED' } }));

    await expect(MarketplaceStoreClaimService.claim(CODE, PUBKY)).resolves.toEqual({ kind: 'session-rejected' });
  });

  it('does not read a refusal reason outside the error object', async () => {
    fetchMock.mockResolvedValue(
      respond(403, { ok: false, reason: 'claim_code_invalid', error: { code: 'UNAUTHORIZED' } }),
    );
    await expect(MarketplaceStoreClaimService.claim(CODE, PUBKY)).rejects.toBeDefined();
  });

  it('reads the claimed seller from an already-claimed answer', async () => {
    fetchMock.mockResolvedValue(
      respond(409, {
        ok: false,
        error: { code: 'STORE_ALREADY_CLAIMED', message: 'The store is already claimed.' },
        seller: PUBKY,
        store: { mode: 'single_seller', state: 'claimed', seller: PUBKY },
      }),
    );
    await expect(MarketplaceStoreClaimService.claim(CODE, PUBKY)).resolves.toEqual({
      kind: 'already-claimed',
      seller: PUBKY,
    });
  });

  it.each([429, 503])('maps Retry-After for status %s without exposing a code or token', async (status) => {
    fetchMock.mockResolvedValue(respond(status, { error: 'rate_limited' }, { 'retry-after': '3' }));
    await expect(MarketplaceStoreClaimService.claim(CODE, PUBKY)).resolves.toEqual({
      kind: 'retry-later',
      retryAfterSeconds: 3,
    });
  });
});
