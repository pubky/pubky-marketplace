import type { GrantSession } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import {
  GRANT_SESSION_CHALLENGE_PURPOSE,
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

const CHALLENGE_URL = 'https://svc.example/api/v1/auth/grant-session-challenges';
const MINT_URL = 'https://svc.example/api/v1/auth/grant-sessions';
const ISSUED = { challenge_id: CHALLENGE_ID, expires_at: '2099-01-01T00:00:00.000Z' };

function grant() {
  const createCustomPop = vi.fn(async (data: { purpose: string }) => ({
    grant: 'grant.jws.sig',
    pop: data.purpose === GRANT_SESSION_CHALLENGE_PURPOSE ? 'challenge-pop.jws.sig' : 'mint-pop.jws.sig',
  }));
  return { grant: asOpaque<GrantSession>({ createCustomPop }), createCustomPop };
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

/** Routes the two service calls; each entry answers its path. */
function service(answers: { challenge?: () => Promise<Response>; mint?: () => Promise<Response> }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === CHALLENGE_URL) return await (answers.challenge ?? (async () => respond(201, ISSUED)))();
    if (url === MINT_URL) return await (answers.mint ?? (async () => respond(201, MINTED)))();
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(HomeserverService.request).mockResolvedValue(asOpaque(undefined));
  vi.mocked(HomeserverService.delete).mockResolvedValue(asOpaque(undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MarketplaceGrantSessionService.mint', () => {
  it('requests a challenge, writes its proof document, signs it and returns the minted session', async () => {
    service({});
    const { grant: session, createCustomPop } = grant();

    const minted = await MarketplaceGrantSessionService.mint({ grant: session, pubky: PUBKY });

    expect(createCustomPop).toHaveBeenNthCalledWith(1, {
      aud: 'https://svc.example',
      purpose: GRANT_SESSION_CHALLENGE_PURPOSE,
    });
    expect(createCustomPop).toHaveBeenNthCalledWith(2, {
      aud: 'https://svc.example',
      challenge_id: CHALLENGE_ID,
      purpose: GRANT_SESSION_PROOF_PURPOSE,
    });
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
    // Challenge, then document, then the mint proof over it.
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(HomeserverService.request).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(HomeserverService.request).mock.invocationCallOrder[0]).toBeLessThan(
      createCustomPop.mock.invocationCallOrder[1],
    );
    const [challengeUrl, challengeInit] = fetchMock.mock.calls[0];
    expect(challengeUrl).toBe(CHALLENGE_URL);
    expect(JSON.parse(String(challengeInit?.body))).toEqual({ grant: 'grant.jws.sig', pop: 'challenge-pop.jws.sig' });
    const [mintUrl, mintInit] = fetchMock.mock.calls[1];
    expect(mintUrl).toBe(MINT_URL);
    expect(mintInit?.method).toBe('POST');
    expect(JSON.parse(String(mintInit?.body))).toEqual({ grant: 'grant.jws.sig', pop: 'mint-pop.jws.sig' });
    expect(minted).toEqual({
      token: MINTED.token,
      sessionId: SESSION_ID,
      pubky: PUBKY,
      capabilities: CAPS,
      expiresAt: MINTED.expires_at,
    });
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('writes nothing when the service refuses the challenge request', async () => {
    service({ challenge: async () => respond(429, { error: 'too_many_challenges' }) });
    const { grant: session, createCustomPop } = grant();

    await expect(MarketplaceGrantSessionService.mint({ grant: session, pubky: PUBKY })).rejects.toMatchObject({
      message: 'too_many_challenges',
      context: { statusCode: 429 },
    });
    expect(createCustomPop).toHaveBeenCalledTimes(1);
    expect(HomeserverService.request).not.toHaveBeenCalled();
    expect(HomeserverService.delete).not.toHaveBeenCalled();
  });

  it('refuses a malformed challenge answer before writing anything', async () => {
    service({ challenge: async () => respond(201, { challenge_id: 'not-a-uuid', expires_at: ISSUED.expires_at }) });

    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_invalid_response',
    });
    expect(HomeserverService.request).not.toHaveBeenCalled();
  });

  it('surfaces the mint refusal code and still deletes the proof document', async () => {
    service({ mint: async () => respond(401, { error: 'grant_session_challenge_invalid' }) });

    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_session_challenge_invalid',
      context: { statusCode: 401 },
    });
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('deletes the proof document when signing the mint proof throws', async () => {
    service({});
    const { grant: session, createCustomPop } = grant();
    createCustomPop.mockResolvedValueOnce({ grant: 'grant.jws.sig', pop: 'challenge-pop.jws.sig' });
    createCustomPop.mockRejectedValueOnce(new Error('signing key unavailable'));

    await expect(MarketplaceGrantSessionService.mint({ grant: session, pubky: PUBKY })).rejects.toThrow(
      'signing key unavailable',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('deletes the proof document when the mint request fails on the network', async () => {
    service({
      mint: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toBeDefined();
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('reports an expired sign-in when the grant session cannot write its homeserver', async () => {
    service({});
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
    expect(createCustomPop).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(HomeserverService.delete).toHaveBeenCalledWith(PROOF_URI);
  });

  it('refuses a session minted for another account or with a malformed body', async () => {
    service({ mint: async () => respond(201, { ...MINTED, pubky: 'z'.repeat(52) }) });
    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_invalid_response',
    });
    service({ mint: async () => respond(201, { ...MINTED, session_id: 'not-a-session' }) });
    await expect(MarketplaceGrantSessionService.mint({ grant: grant().grant, pubky: PUBKY })).rejects.toMatchObject({
      message: 'grant_invalid_response',
    });
  });

  it('does not echo an unexpected error string from the service', async () => {
    service({ mint: async () => respond(400, { error: '<script>' }) });
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
