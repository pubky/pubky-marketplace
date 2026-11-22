/** @vitest-environment node */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CliGrantConfig } from './config';
import { encodeBase64Url, sha256Bytes } from './crypto';
import {
  assertProofMatches,
  expectedProofDocument,
  fetchHomeserverProofDocument,
  type HomeserverProofDeps,
  parseProofDocument,
} from './homeserver-proof';
import { HomeserverFetchDenied } from './ssrf';

const config = {
  homeserverFetchTimeoutMs: 5000,
} as CliGrantConfig;

const pubky = 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';
const challengeId = '018f4f36-7a61-7d4e-8f22-3e31ed45d2af';
const nonce = new Uint8Array(32).fill(9);
const expected = expectedProofDocument({
  aud: 'https://shop.example',
  challengeId,
  exp: 1_760_000_060,
  iat: 1_760_000_000,
  nonce,
  pubky,
  resultCpk: pubky,
  resultDeliveryId: encodeBase64Url(new Uint8Array(32).fill(4)),
});

function deps(overrides: Partial<HomeserverProofDeps> = {}): HomeserverProofDeps {
  return {
    resolveHomeserverZ32: async () => 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy',
    homeserverHttpsOrigin: () => 'https://homeserver.example',
    configuredHomeserverZ32: () => 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy',
    acceptsUserHomeserver: () => false,
    resolveHomeserverHttpsOrigin: async () => null,
    fetchProof: async () => new Response(JSON.stringify(expected), { status: 200 }),
    checkTarget: async () => undefined,
    ...overrides,
  };
}

const OWN_HOMESERVER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** A store, for a user whose signed record names their own homeserver, not the configured one. */
function storeDeps(overrides: Partial<HomeserverProofDeps> = {}): HomeserverProofDeps {
  return deps({
    resolveHomeserverZ32: async () => OWN_HOMESERVER,
    acceptsUserHomeserver: () => true,
    resolveHomeserverHttpsOrigin: async (homeserver) =>
      homeserver === OWN_HOMESERVER ? 'https://own-homeserver.example' : null,
    ...overrides,
  });
}

describe('CLI homeserver-session proof fetch', () => {
  it('does not GET when pkarr z32 does not match this deploy', async () => {
    const fetchProof = vi.fn();
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        deps({
          resolveHomeserverZ32: async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          fetchProof,
        }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it('does not GET when the SSRF check fails', async () => {
    const fetchProof = vi.fn();
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        deps({
          checkTarget: async () => {
            throw new HomeserverFetchDenied();
          },
          fetchProof,
        }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it('GETs with pubky-host and no cookies, then requires JCS equality', async () => {
    const fetchProof = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.href).toBe(`https://homeserver.example/pub/pubky.app/marketplace/v1/cli-grant-proofs/${challengeId}`);
      expect(url.search).toBe('');
      expect(init.headers).toEqual({ 'pubky-host': pubky, accept: 'application/json' });
      expect(init.redirect).toBe('error');
      return new Response(JSON.stringify(expected), { status: 200 });
    });
    const parsed = await fetchHomeserverProofDocument(config, pubky, challengeId, deps({ fetchProof }));
    expect(parseProofDocument(parsed)).toEqual(expected);
    expect(() => assertProofMatches(parsed, expected)).not.toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() => parseProofDocument({ ...expected, extra: true })).toThrow(HomeserverFetchDenied);
  });

  it('rejects a document that does not JCS-equal the expected object', () => {
    const other = { ...expected, aud: 'https://other.example' };
    expect(() => assertProofMatches(other, expected)).toThrow(HomeserverFetchDenied);
  });

  it('uses a distinct challenge id per call', () => {
    expect(expected.challenge_id).not.toBe(randomUUID());
    expect(expected.nonce_hash).toBe(encodeBase64Url(sha256Bytes(nonce)));
  });
});

describe('store-mode homeserver-session proof fetch', () => {
  it("GETs from the user's own homeserver, at the origin its signed record publishes", async () => {
    const resolveHomeserverHttpsOrigin = vi.fn(async () => 'https://own-homeserver.example');
    const checkTarget = vi.fn(async () => undefined);
    const fetchProof = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.href).toBe(
        `https://own-homeserver.example/pub/pubky.app/marketplace/v1/cli-grant-proofs/${challengeId}`,
      );
      expect(init.headers).toEqual({ 'pubky-host': pubky, accept: 'application/json' });
      expect(init.redirect).toBe('error');
      return new Response(JSON.stringify(expected), { status: 200 });
    });
    const parsed = await fetchHomeserverProofDocument(
      config,
      pubky,
      challengeId,
      storeDeps({ resolveHomeserverHttpsOrigin, checkTarget, fetchProof }),
    );
    expect(() => assertProofMatches(parsed, expected)).not.toThrow();
    expect(resolveHomeserverHttpsOrigin).toHaveBeenCalledWith(OWN_HOMESERVER, config.homeserverFetchTimeoutMs);
    expect(checkTarget).toHaveBeenCalledWith(
      new URL(`https://own-homeserver.example/pub/pubky.app/marketplace/v1/cli-grant-proofs/${challengeId}`),
    );
  });

  it('keeps the configured URL for a user on the configured homeserver', async () => {
    const resolveHomeserverHttpsOrigin = vi.fn();
    const fetchProof = vi.fn(async (url: URL) => {
      expect(url.origin).toBe('https://homeserver.example');
      return new Response(JSON.stringify(expected), { status: 200 });
    });
    await fetchHomeserverProofDocument(
      config,
      pubky,
      challengeId,
      storeDeps({
        resolveHomeserverZ32: async () => 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy',
        resolveHomeserverHttpsOrigin,
        fetchProof,
      }),
    );
    expect(resolveHomeserverHttpsOrigin).not.toHaveBeenCalled();
  });

  it("asks for the endpoint of the homeserver the user's record names, and no other", async () => {
    const resolveHomeserverHttpsOrigin = vi.fn(async () => 'https://own-homeserver.example');
    const fetchProof = vi.fn(async () => new Response(JSON.stringify(expected), { status: 200 }));
    await fetchHomeserverProofDocument(
      config,
      pubky,
      challengeId,
      storeDeps({ resolveHomeserverHttpsOrigin, fetchProof }),
    );
    expect(resolveHomeserverHttpsOrigin.mock.calls).toEqual([[OWN_HOMESERVER, config.homeserverFetchTimeoutMs]]);
  });

  it('does not GET when the user publishes no homeserver', async () => {
    const fetchProof = vi.fn();
    const resolveHomeserverHttpsOrigin = vi.fn(async () => 'https://own-homeserver.example');
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        storeDeps({ resolveHomeserverZ32: async () => null, resolveHomeserverHttpsOrigin, fetchProof }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(resolveHomeserverHttpsOrigin).not.toHaveBeenCalled();
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it("does not GET when the user's homeserver publishes no verified endpoint", async () => {
    const fetchProof = vi.fn();
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        storeDeps({ resolveHomeserverHttpsOrigin: async () => null, fetchProof }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it.each([
    ['the user record lookup', { resolveHomeserverZ32: async () => Promise.reject(new Error('pkarr down')) }],
    [
      'the homeserver endpoint lookup',
      { resolveHomeserverHttpsOrigin: async () => Promise.reject(new Error('relays down')) },
    ],
  ])('denies when %s fails', async (_label, overrides) => {
    const fetchProof = vi.fn();
    await expect(
      fetchHomeserverProofDocument(config, pubky, challengeId, storeDeps({ ...overrides, fetchProof })),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it.each([
    ['a private address', 'https://10.0.0.8'],
    ['plain HTTP', 'http://own-homeserver.example'],
    ['another port', 'https://own-homeserver.example:6287'],
    ['credentials in the URL', 'https://user:pass@own-homeserver.example'],
  ])('does not GET from a forged host: %s', async (_label, origin) => {
    const fetchProof = vi.fn();
    const { assertSafeHomeserverTarget } = await import('./ssrf');
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        storeDeps({
          resolveHomeserverHttpsOrigin: async () => origin,
          checkTarget: assertSafeHomeserverTarget,
          fetchProof,
        }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it('denies a redirect, a non-200 answer and an oversized body from the own homeserver', async () => {
    for (const response of [
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }),
      new Response('nope', { status: 404 }),
      new Response('x'.repeat(17 * 1024), { status: 200 }),
    ]) {
      await expect(
        fetchHomeserverProofDocument(config, pubky, challengeId, storeDeps({ fetchProof: async () => response })),
      ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    }
  });

  it('stays closed to other homeservers outside store mode', async () => {
    const fetchProof = vi.fn();
    const resolveHomeserverHttpsOrigin = vi.fn(async () => 'https://own-homeserver.example');
    await expect(
      fetchHomeserverProofDocument(
        config,
        pubky,
        challengeId,
        storeDeps({ acceptsUserHomeserver: () => false, resolveHomeserverHttpsOrigin, fetchProof }),
      ),
    ).rejects.toBeInstanceOf(HomeserverFetchDenied);
    expect(resolveHomeserverHttpsOrigin).not.toHaveBeenCalled();
    expect(fetchProof).not.toHaveBeenCalled();
  });
});
