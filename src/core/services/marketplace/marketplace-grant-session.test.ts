import type { GrantSession } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import {
  GRANT_SESSION_PROOF_DOMAIN,
  GRANT_SESSION_PROOF_PURPOSE,
  MarketplaceGrantSessionService,
} from './marketplace-grant-session';

vi.mock('@/services/homeserver/homeserver', () => ({
  HomeserverService: { request: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/config/commerce', async (original) => ({
  ...(await original<typeof import('@/config/commerce')>()),
  getMarketplaceUrl: () => 'https://svc.example/api',
}));
vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PUBKY = 'y'.repeat(52);
const CHALLENGE_ID = '018f4f36-7a61-4d4e-8f22-3e31ed45d2af';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const PROOF_URI = `pubky://${PUBKY}/pub/pubky.app/marketplace/v1/session-proofs/${CHALLENGE_ID}`;
const CAPS = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
const MINTED = {
  token: 't'.repeat(43),
  session_id: SESSION_ID,
  pubky: PUBKY,
  capabilities: CAPS,
  expires_at: '2099-01-01T00:00:00.000Z',
};

function grant() {
  const createCustomPop = vi.fn(async () => ({ grant: 'grant.jws.sig', pop: 'pop.jws.sig' }));
  return { grant: asOpaque<GrantSession>({ createCustomPop }), createCustomPop };
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(CHALLENGE_ID);
  vi.mocked(HomeserverService.request).mockResolvedValue(asOpaque(undefined));
  vi.mocked(HomeserverService.delete).mockResolvedValue(asOpaque(undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MarketplaceGrantSessionService.mint', () => {
  it('writes the proof document, signs the same challenge and returns the minted session', async () => {
    fetchMock.mockResolvedValue(respond(201, MINTED));
    const { grant: session, createCustomPop } = grant();

    const minted = await MarketplaceGrantSessionService.mint({ grant: session, pubky: PUBKY });

    expect(HomeserverService.request).toHaveBeenCalledWith({
      method: HttpMethod.PUT,
      url: PROOF_URI,
      bodyJson: {
        aud: 'https://svc.example',
        challenge_id: CHALLENGE_ID,
        domain: GRANT_SESSION_PROOF_DOMAIN,
        pubky: PUBKY,
      },
    });
    expect(createCustomPop).toHaveBeenCalledWith({
      aud: 'https://svc.example',
      challenge_id: CHALLENGE_ID,
      purpose: GRANT_SESSION_PROOF_PURPOSE,
    });
    expect(vi.mocked(HomeserverService.request).mock.invocationCallOrder[0]).toBeLessThan(
      createCustomPop.mock.invocationCallOrder[0],
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://svc.example/api/v1/auth/grant-sessions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ grant: 'grant.jws.sig', pop: 'pop.jws.sig' });
    expect(minted).toEqual({
      token: MINTED.token,
      sessionId: SESSION_ID,
      pubky: PUBKY,
      capabilities: CAPS,
      expiresAt: MINTED.expires_at,
    });
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('surfaces the service refusal code and still deletes the proof document', async () => {
    fetchMock.mockResolvedValue(respond(401, { error: 'homeserver_proof_invalid' }));

    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'homeserver_proof_invalid',
      context: { statusCode: 401 },
    });
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('reports an expired sign-in when the grant session cannot write its homeserver', async () => {
    vi.mocked(HomeserverService.request).mockRejectedValue(
      new AppError({
        category: ErrorCategory.Auth,
        code: AuthErrorCode.SESSION_EXPIRED,
        message: 'expired',
        service: ErrorService.Homeserver,
        operation: 'put',
      }),
    );
    const { grant: session, createCustomPop } = grant();

    await expect(MarketplaceGrantSessionService.mint({ grant: session, pubky: PUBKY })).rejects.toMatchObject({
      message: 'shop_session_expired',
      category: ErrorCategory.Auth,
    });
    expect(createCustomPop).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('refuses a session minted for another account or with a malformed body', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { ...MINTED, pubky: 'z'.repeat(52) }));
    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_invalid_response',
    });
    fetchMock.mockResolvedValueOnce(respond(201, { ...MINTED, session_id: 'not-a-session' }));
    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_invalid_response',
    });
  });

  it('does not echo an unexpected error string from the service', async () => {
    fetchMock.mockResolvedValue(respond(400, { error: '<script>' }));
    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_session_unavailable',
    });
  });
});

describe('MarketplaceGrantSessionService.revoke', () => {
  it('deletes the session at the service with its own bearer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await MarketplaceGrantSessionService.revoke({ token: MINTED.token, sessionId: SESSION_ID });
    expect(fetchMock).toHaveBeenCalledWith(`https://svc.example/api/v1/auth/sessions/${SESSION_ID}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${MINTED.token}` },
      cache: 'no-store',
    });
  });

  it('never throws on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(
      MarketplaceGrantSessionService.revoke({ token: MINTED.token, sessionId: SESSION_ID }),
    ).resolves.toBeUndefined();
  });
});
