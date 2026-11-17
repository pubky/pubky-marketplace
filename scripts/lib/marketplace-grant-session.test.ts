// @vitest-environment node
import { inspect } from 'node:util';
import type { Pubky } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockKeypair, mockSession } from '@/test-utils/pubky';
import { asOpaque } from '@/test-utils/type-assertions';
import { mintMarketplaceGrantSession, mintMarketplaceGrantSessionForSigner } from './marketplace-grant-session.mjs';

const PUBKY = 'y'.repeat(52);
const SERVICE = 'https://service.example/api';
const CAPS = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
const CHALLENGE = '018f4f36-7a61-4d4e-8f22-3e31ed45d2af';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const PROOF_PATH = `/pub/pubky.app/marketplace/v1/session-proofs/${CHALLENGE}`;
const ISSUED = { challenge_id: CHALLENGE, expires_at: '2099-01-01T00:00:00Z' };
const MINTED = {
  token: 't'.repeat(43),
  session_id: SESSION_ID,
  pubky: PUBKY,
  capabilities: CAPS,
  expires_at: '2099-01-01T00:00:00Z',
};
const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();

function homeserver() {
  const createCustomPop = vi.fn(async () => ({ grant: 'test.grant.signature', pop: 'test.pop.signature' }));
  const putJson = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  const signout = vi.fn(async () => {});
  const session = mockSession({
    info: asOpaque({ publicKey: { z32: () => PUBKY } }),
    grant: asOpaque({ createCustomPop }),
    storage: asOpaque({ putJson, delete: remove }),
    signout,
  });
  return { session, createCustomPop, putJson, remove, signout };
}

function service({
  challenge = ISSUED,
  challengeStatus = 201,
  minted = MINTED,
  mintStatus = 201,
  revokeStatus = 204,
} = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === `${SERVICE}/v1/auth/grant-session-challenges`) return json(challenge, challengeStatus);
    if (String(input) === `${SERVICE}/v1/auth/grant-sessions`) return json(minted, mintStatus);
    if (String(input) === `${SERVICE}/v1/auth/sessions/${minted.session_id}` && init?.method === 'DELETE') {
      return new Response(null, { status: revokeStatus });
    }
    throw new Error('Unexpected service request');
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  service();
});
afterEach(() => vi.unstubAllGlobals());

describe('Node marketplace grant mint', () => {
  it('signs for the service origin, writes its unique proof before minting and removes it without ending a borrowed grant', async () => {
    const { session, createCustomPop, putJson, remove, signout } = homeserver();
    const minted = await mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: `${SERVICE}/` });
    expect(minted).toEqual({
      token: MINTED.token,
      sessionId: SESSION_ID,
      pubky: PUBKY,
      capabilities: CAPS,
      expiresAt: MINTED.expires_at,
    });
    expect(createCustomPop).toHaveBeenNthCalledWith(1, {
      aud: 'https://service.example',
      purpose: 'marketplace-service/grant-session-challenge/v1',
    });
    expect(putJson).toHaveBeenCalledWith(PROOF_PATH, {
      aud: 'https://service.example',
      challenge_id: CHALLENGE,
      domain: 'marketplace-service/grant-session-proof/v1',
      pubky: PUBKY,
    });
    expect(createCustomPop).toHaveBeenNthCalledWith(2, {
      aud: 'https://service.example',
      challenge_id: CHALLENGE,
      purpose: 'marketplace-service/grant-session/v1',
    });
    expect(putJson.mock.invocationCallOrder[0]).toBeGreaterThan(fetchMock.mock.invocationCallOrder[0]);
    expect(putJson.mock.invocationCallOrder[0]).toBeLessThan(createCustomPop.mock.invocationCallOrder[1]);
    expect(remove).toHaveBeenCalledWith(PROOF_PATH);
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(fetchMock.mock.invocationCallOrder[1]);
    expect(signout).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${SERVICE}/v1/auth/grant-session-challenges`,
      `${SERVICE}/v1/auth/grant-sessions`,
    ]);
    for (const [, request] of fetchMock.mock.calls) {
      expect(request?.method).toBe('POST');
      expect(request?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(request?.body))).toEqual({ grant: 'test.grant.signature', pop: 'test.pop.signature' });
    }
  });

  it('accepts reordered capabilities and historical UUID-shaped service ids', async () => {
    service({
      minted: {
        ...MINTED,
        capabilities: CAPS.split(',').reverse().join(','),
        session_id: 'ddce4ef4-d106-d521-dbac-e40c5b650767',
      },
    });
    const minted = await mintMarketplaceGrantSession({
      session: homeserver().session,
      expectedPubky: PUBKY,
      serviceUrl: SERVICE,
    });
    expect(minted.sessionId).toBe('ddce4ef4-d106-d521-dbac-e40c5b650767');
  });

  it('permits an explicitly expected narrow service grant without broadening it', async () => {
    const narrow = '/pub/pubky.app/marketplace-service/v1/:rw';
    service({ minted: { ...MINTED, capabilities: narrow } });
    await expect(
      mintMarketplaceGrantSession({
        session: homeserver().session,
        expectedPubky: PUBKY,
        serviceUrl: SERVICE,
        acceptedCapabilities: [narrow],
      }),
    ).resolves.toMatchObject({ capabilities: narrow });
  });

  it.each(['wrong-account', 'no-grant'])('refuses %s before network or storage access', async (kind) => {
    const { session, putJson } = homeserver();
    const supplied = kind === 'no-grant' ? mockSession({ ...session, grant: undefined }) : session;
    await expect(
      mintMarketplaceGrantSession({
        session: supplied,
        expectedPubky: kind === 'wrong-account' ? 'other' : PUBKY,
        serviceUrl: SERVICE,
      }),
    ).rejects.toThrow('does not belong');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putJson).not.toHaveBeenCalled();
  });

  it('refuses a malformed challenge before writing or deleting a path', async () => {
    service({ challenge: { ...ISSUED, challenge_id: '../other' } });
    const { session, putJson, remove } = homeserver();
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'invalid grant challenge',
    );
    expect(putJson).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('requires the challenge endpoint to return 201', async () => {
    service({ challengeStatus: 200 });
    const { session, putJson } = homeserver();
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'invalid grant challenge',
    );
    expect(putJson).not.toHaveBeenCalled();
  });

  it('attempts deletion when the proof write fails and never mints', async () => {
    const { session, putJson, remove } = homeserver();
    putJson.mockRejectedValueOnce(new Error('sensitive SDK detail'));
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'Could not write the marketplace grant proof',
    );
    expect(remove).toHaveBeenCalledWith(PROOF_PATH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deletes the proof on mint refusal without exposing the service body', async () => {
    service({ minted: { ...MINTED, token: 'sensitive response' }, mintStatus: 403 });
    const { session, remove } = homeserver();
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'Marketplace grant request failed (HTTP 403)',
    );
    expect(remove).toHaveBeenCalledWith(PROOF_PATH);
  });

  it.each([
    { pubky: 'different-account' },
    { capabilities: '/:rw' },
    { capabilities: '/pub/pubky.app/marketplace-service/v1/:rw' },
  ])('revokes a minted bearer with unexpected response fields %o', async (fields) => {
    service({ minted: { ...MINTED, ...fields } });
    const { session, remove } = homeserver();
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'unexpected account or capability set',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${SERVICE}/v1/auth/sessions/${SESSION_ID}`,
      expect.objectContaining({ method: 'DELETE', headers: { authorization: `Bearer ${MINTED.token}` } }),
    );
    expect(remove).toHaveBeenCalledWith(PROOF_PATH);
  });

  it('rejects a malformed session id without using it as a revocation path', async () => {
    service({ minted: { ...MINTED, session_id: '../other' } });
    const { session, remove } = homeserver();
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'invalid grant session',
    );
    expect(remove).toHaveBeenCalledWith(PROOF_PATH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['not-a-date', '2020-01-01T00:00:00Z'])(
    'revokes a usable bearer when its returned expiry is invalid: %s',
    async (expires_at) => {
      service({ minted: { ...MINTED, expires_at } });
      const { session, remove } = homeserver();
      await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
        'invalid grant session',
      );
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${SERVICE}/v1/auth/sessions/${SESSION_ID}`,
        expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }),
      );
      expect(remove).toHaveBeenCalledWith(PROOF_PATH);
    },
  );

  it.each(['', 'too-short', '+'.repeat(43)])(
    'refuses an invalid bearer without sending it in an authorization header',
    async (token) => {
      service({ minted: { ...MINTED, token } });
      await expect(
        mintMarketplaceGrantSession({ session: homeserver().session, expectedPubky: PUBKY, serviceUrl: SERVICE }),
      ).rejects.toThrow('invalid grant session');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('revokes a bearer returned with an unexpected success status', async () => {
    service({ mintStatus: 200 });
    await expect(
      mintMarketplaceGrantSession({ session: homeserver().session, expectedPubky: PUBKY, serviceUrl: SERVICE }),
    ).rejects.toThrow('invalid grant session');
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${SERVICE}/v1/auth/sessions/${SESSION_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('preserves mint refusal when proof deletion also fails', async () => {
    service({ mintStatus: 403 });
    const { session, remove } = homeserver();
    remove.mockRejectedValueOnce(new Error('sensitive delete detail'));
    const error = await mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE }).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({
      message: 'Marketplace grant request failed (HTTP 403)',
      errors: [
        expect.objectContaining({ message: 'Marketplace grant request failed (HTTP 403)' }),
        expect.objectContaining({ message: 'Could not delete the marketplace grant proof' }),
      ],
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(String(error)).not.toContain('sensitive');
  });

  it('preserves an invalid session response when both revocation and proof deletion fail', async () => {
    service({ minted: { ...MINTED, expires_at: 'not-a-date' }, revokeStatus: 503 });
    const { session, remove } = homeserver();
    remove.mockRejectedValueOnce(new Error('sensitive proof cleanup detail'));
    const error = await mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE }).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({
      message: 'Marketplace returned an invalid grant session',
      errors: [
        expect.objectContaining({
          errors: [
            expect.objectContaining({ message: 'Marketplace returned an invalid grant session' }),
            expect.objectContaining({
              message: 'Marketplace grant cleanup failed; could not revoke the minted service session',
            }),
          ],
        }),
        expect.objectContaining({ message: 'Could not delete the marketplace grant proof' }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledOnce();
    expect(inspect(error)).not.toContain('sensitive');
  });

  it('retains a rejected bearer for proof-cleanup revocation after its first revoke fails', async () => {
    const events: string[] = [];
    fetchMock
      .mockResolvedValueOnce(json(ISSUED))
      .mockResolvedValueOnce(json({ ...MINTED, capabilities: '/:rw' }))
      .mockImplementationOnce(async () => {
        events.push('first revoke');
        return new Response(null, { status: 503 });
      })
      .mockImplementationOnce(async () => {
        events.push('cleanup revoke');
        return new Response(null, { status: 204 });
      });
    const { session, remove } = homeserver();
    remove.mockImplementationOnce(async () => {
      events.push('delete proof');
      throw new Error('sensitive proof cleanup detail');
    });
    const error = await mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE }).catch(
      (error: unknown) => error,
    );
    expect(events).toEqual(['first revoke', 'delete proof', 'cleanup revoke']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error).toMatchObject({
      message: 'Marketplace returned a grant session for an unexpected account or capability set',
      cause: expect.objectContaining({
        message: 'Marketplace returned a grant session for an unexpected account or capability set',
      }),
    });
    expect(inspect(error)).not.toContain('sensitive');
  });

  it('keeps proof deletion as the failure when revoking the undelivered bearer also fails', async () => {
    service({ revokeStatus: 503 });
    const { session, remove } = homeserver();
    remove.mockRejectedValueOnce(new Error('sensitive proof cleanup detail'));
    const error = await mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE }).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({
      message: 'Could not delete the marketplace grant proof',
      errors: [
        expect.objectContaining({ message: 'Could not delete the marketplace grant proof' }),
        expect.objectContaining({
          message: 'Marketplace grant cleanup failed; could not revoke the minted service session',
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(inspect(error)).not.toContain('sensitive');
  });

  it('revokes a successfully minted bearer if proof cleanup prevents returning it', async () => {
    const { session, remove } = homeserver();
    remove.mockRejectedValueOnce(new Error('sensitive storage error'));
    await expect(mintMarketplaceGrantSession({ session, expectedPubky: PUBKY, serviceUrl: SERVICE })).rejects.toThrow(
      'Could not delete the marketplace grant proof',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${SERVICE}/v1/auth/sessions/${SESSION_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('owned script grant', () => {
  function owned() {
    const home = homeserver();
    const signin = vi.fn(async () => home.session);
    const keypair = mockKeypair({ publicKey: asOpaque({ z32: () => PUBKY }) });
    const client = asOpaque<Pubky>({ signer: vi.fn(() => ({ signin })) });
    return { ...home, signin, options: { client, keypair, clientId: 'shop.pubky.app', serviceUrl: SERVICE } };
  }

  it('ends only its own grant after proof cleanup and returns the service bearer', async () => {
    const { options, signin, remove, signout } = owned();
    await expect(mintMarketplaceGrantSessionForSigner(options)).resolves.toMatchObject({ token: MINTED.token });
    expect(signin).toHaveBeenCalledWith('shop.pubky.app');
    expect(signout).toHaveBeenCalledOnce();
    expect(signout.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0]);
  });

  it('ends its grant when challenge creation fails', async () => {
    const { options, signout } = owned();
    fetchMock.mockRejectedValueOnce(new Error('sensitive connection error'));
    await expect(mintMarketplaceGrantSessionForSigner(options)).rejects.toThrow('HTTP unavailable');
    expect(signout).toHaveBeenCalledOnce();
  });

  it('preserves the challenge failure when signout also fails', async () => {
    const { options, signout } = owned();
    fetchMock.mockRejectedValueOnce(new Error('sensitive connection detail'));
    signout.mockRejectedValueOnce(new Error('sensitive signout detail'));
    const error = await mintMarketplaceGrantSessionForSigner(options).catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: 'Marketplace grant request failed (HTTP unavailable)',
      errors: [
        expect.objectContaining({ message: 'Marketplace grant request failed (HTTP unavailable)' }),
        expect.objectContaining({ message: 'Could not end the temporary homeserver grant session' }),
      ],
    });
    expect(signout).toHaveBeenCalledOnce();
    expect(String(error)).not.toContain('sensitive');
  });

  it('keeps signout as the failure when revoking the undelivered bearer also fails', async () => {
    service({ revokeStatus: 503 });
    const { options, signout } = owned();
    signout.mockRejectedValueOnce(new Error('sensitive signout detail'));
    const error = await mintMarketplaceGrantSessionForSigner(options).catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: 'Could not end the temporary homeserver grant session',
      errors: [
        expect.objectContaining({ message: 'Could not end the temporary homeserver grant session' }),
        expect.objectContaining({
          message: 'Marketplace grant cleanup failed; could not revoke the minted service session',
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signout).toHaveBeenCalledOnce();
    expect(inspect(error)).not.toContain('sensitive');
  });

  it('revokes the minted service bearer if ending the owned grant fails', async () => {
    const { options, signout } = owned();
    signout.mockRejectedValueOnce(new Error('sensitive SDK detail'));
    await expect(mintMarketplaceGrantSessionForSigner(options)).rejects.toThrow(
      'Could not end the temporary homeserver grant session',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${SERVICE}/v1/auth/sessions/${SESSION_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
