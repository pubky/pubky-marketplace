import { Pubky, PublicKey } from '@synonymdev/pubky';
import { z } from 'zod';
import { getHomeserver, getHomeserverUrl, getPkarrRelays, getStoreSeller } from '@/libs/runtime-config/runtime-config';
import { readBodyWithin } from './capped-body';
import type { CliGrantConfig } from './config';
import { canonicalJson, encodeBase64Url, sha256Bytes } from './crypto';
import { resolveHomeserverHttpsOrigin } from './homeserver-endpoint';
import { assertSafeHomeserverTarget, HomeserverFetchDenied, proofPath } from './ssrf';

const PROOF_BODY_LIMIT = 16 * 1024;
export const PROOF_DOMAIN = 'shop-bff/cli-grant-homeserver-pop/v1';

export type ExpectedProof = {
  aud: string;
  challenge_id: string;
  domain: typeof PROOF_DOMAIN;
  exp: number;
  iat: number;
  nonce_hash: string;
  pubky: string;
  result_cpk: string;
  result_delivery_id: string;
};

const proofSchema = z
  .object({
    aud: z.string(),
    challenge_id: z.string(),
    domain: z.literal(PROOF_DOMAIN),
    exp: z.number().int(),
    iat: z.number().int(),
    nonce_hash: z.string(),
    pubky: z.string(),
    result_cpk: z.string(),
    result_delivery_id: z.string(),
  })
  .strict();

export function proofUri(pubky: string, challengeId: string): string {
  return `pubky://${pubky}/pub/pubky.app/marketplace/v1/cli-grant-proofs/${challengeId}`;
}

export function expectedProofDocument(input: {
  aud: string;
  challengeId: string;
  exp: number;
  iat: number;
  nonce: Uint8Array;
  pubky: string;
  resultCpk: string;
  resultDeliveryId: string;
}): ExpectedProof {
  return {
    aud: input.aud,
    challenge_id: input.challengeId,
    domain: PROOF_DOMAIN,
    exp: input.exp,
    iat: input.iat,
    nonce_hash: encodeBase64Url(sha256Bytes(input.nonce)),
    pubky: input.pubky,
    result_cpk: input.resultCpk,
    result_delivery_id: input.resultDeliveryId,
  };
}

export function parseProofDocument(value: unknown): ExpectedProof {
  try {
    return proofSchema.parse(value);
  } catch {
    throw new HomeserverFetchDenied();
  }
}

export function assertProofMatches(parsed: unknown, expected: ExpectedProof): void {
  if (canonicalJson(parsed) !== canonicalJson(expected)) throw new HomeserverFetchDenied();
}

export type HomeserverProofDeps = {
  resolveHomeserverZ32: (pubky: string) => Promise<string | null>;
  homeserverHttpsOrigin: () => string;
  configuredHomeserverZ32: () => string;
  /** Whether a user on another homeserver than the configured one may prove a session (store mode). */
  acceptsUserHomeserver: () => boolean;
  /** The HTTPS origin a homeserver key publishes in its own signed Pkarr record. */
  resolveHomeserverHttpsOrigin: (homeserverZ32: string, timeoutMs: number) => Promise<string | null>;
  fetchProof: (url: URL, init: RequestInit) => Promise<Response>;
  checkTarget: (url: URL) => Promise<void>;
};

const defaultDeps: HomeserverProofDeps = {
  async resolveHomeserverZ32(pubky) {
    const user = PublicKey.from(pubky);
    const resolved = await new Pubky().getHomeserverOf(user);
    return resolved?.z32() ?? null;
  },
  homeserverHttpsOrigin: () => getHomeserverUrl(),
  configuredHomeserverZ32: () => getHomeserver(),
  acceptsUserHomeserver: () => getStoreSeller() !== undefined,
  resolveHomeserverHttpsOrigin: (homeserverZ32, timeoutMs) =>
    resolveHomeserverHttpsOrigin(homeserverZ32, {
      relays: getPkarrRelays(),
      fetchRelay: (url, init) => fetch(url, init),
      timeoutMs,
    }),
  fetchProof: (url, init) => fetch(url, init),
  checkTarget: assertSafeHomeserverTarget,
};

/**
 * Reads the proof document from the homeserver the user's own signed Pkarr record names.
 *
 * The full Market accepts only its configured homeserver, at its configured URL. A store also
 * accepts any other homeserver the user's record names, at the origin that homeserver's own
 * signed record publishes (`resolveHomeserverHttpsOrigin`). Either way the request goes over
 * HTTPS on port 443 to a public address (`checkTarget`), names the user in `pubky-host`, follows
 * no redirect and reads at most {@link PROOF_BODY_LIMIT} bytes, stopping the stream there; every
 * failure is a denial.
 */
export async function fetchHomeserverProofDocument(
  config: CliGrantConfig,
  pubky: string,
  challengeId: string,
  deps: HomeserverProofDeps = defaultDeps,
): Promise<unknown> {
  try {
    const resolved = await deps.resolveHomeserverZ32(pubky);
    if (!resolved) throw new HomeserverFetchDenied();
    let originHref: string | null;
    if (resolved === deps.configuredHomeserverZ32()) {
      originHref = deps.homeserverHttpsOrigin();
    } else if (deps.acceptsUserHomeserver()) {
      originHref = await deps.resolveHomeserverHttpsOrigin(resolved, config.homeserverFetchTimeoutMs);
    } else {
      throw new HomeserverFetchDenied();
    }
    if (!originHref) throw new HomeserverFetchDenied();
    const origin = new URL(originHref);
    origin.pathname = '/';
    origin.search = '';
    origin.hash = '';
    const url = new URL(proofPath(challengeId), origin);
    await deps.checkTarget(url);
    const response = await deps.fetchProof(url, {
      method: 'GET',
      headers: { 'pubky-host': pubky, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(config.homeserverFetchTimeoutMs),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new HomeserverFetchDenied();
    }
    const body = await readBodyWithin(response, PROOF_BODY_LIMIT);
    if (!body) throw new HomeserverFetchDenied();
    try {
      return JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
      throw new HomeserverFetchDenied();
    }
  } catch (error) {
    if (error instanceof HomeserverFetchDenied) throw error;
    throw new HomeserverFetchDenied();
  }
}
