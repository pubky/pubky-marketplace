// Node counterpart of MarketplaceGrantSessionService. A live homeserver grant proves
// possession through the service's single-use document; no cookie session is minted.
import { z } from 'zod';
import { withCleanup } from './with-cleanup.mjs';

const CHALLENGE_PURPOSE = 'marketplace-service/grant-session-challenge/v1';
const PROOF_PURPOSE = 'marketplace-service/grant-session/v1';
const PROOF_DOMAIN = 'marketplace-service/grant-session-proof/v1';
const PROOFS_PATH = '/pub/pubky.app/marketplace/v1/session-proofs/';
const PURCHASE_CAPABILITIES = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';

const challengeSchema = z.object({ challenge_id: z.uuid(), expires_at: z.iso.datetime({ offset: true }) });
const revocationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  // Service migration 0035 also produced UUID-shaped md5 ids with arbitrary version/variant nibbles.
  session_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
});
const sessionSchema = revocationSchema.extend({
  pubky: z.string(),
  capabilities: z.string(),
  expires_at: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now()),
});

const normalizedCapabilities = (value) =>
  value
    .split(',')
    .map((scope) => scope.trim())
    .sort()
    .join(',');

async function revokeMinted(serviceUrl, minted) {
  const response = await fetch(`${serviceUrl}/v1/auth/sessions/${encodeURIComponent(minted.sessionId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${minted.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error('Marketplace grant cleanup failed; could not revoke the minted service session');
}

/**
 * Borrows an existing grant session. The caller retains ownership of that session.
 * @param {{ session: import('@synonymdev/pubky').Session, expectedPubky: string, serviceUrl: string,
 *   acceptedCapabilities?: readonly string[] }} options
 */
export async function mintMarketplaceGrantSession({
  session,
  expectedPubky,
  serviceUrl,
  acceptedCapabilities = [PURCHASE_CAPABILITIES],
}) {
  const base = serviceUrl.replace(/\/+$/, '');
  const audience = new URL(base).origin;
  const grant = session.grant;
  if (!grant || session.info.publicKey.z32() !== expectedPubky) {
    throw new Error('Marketplace grant session does not belong to the expected account');
  }
  const post = async (path, proof) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: proof.grant, pop: proof.pop }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response?.ok) throw new Error(`Marketplace grant request failed (HTTP ${response?.status ?? 'unavailable'})`);
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const challengeProof = await grant.createCustomPop({ aud: audience, purpose: CHALLENGE_PURPOSE }).catch(() => {
    throw new Error('Could not sign the marketplace grant challenge');
  });
  const challengeResponse = await post('/v1/auth/grant-session-challenges', challengeProof);
  const issued = challengeSchema.safeParse(challengeResponse.body);
  if (challengeResponse.status !== 201 || !issued.success)
    throw new Error('Marketplace returned an invalid grant challenge');
  const challengeId = issued.data.challenge_id;
  const proofPath = `${PROOFS_PATH}${challengeId}`;
  let minted;
  return withCleanup(
    async () => {
      await session.storage
        .putJson(proofPath, {
          aud: audience,
          challenge_id: challengeId,
          domain: PROOF_DOMAIN,
          pubky: expectedPubky,
        })
        .catch(() => {
          throw new Error('Could not write the marketplace grant proof');
        });
      const proof = await grant
        .createCustomPop({ aud: audience, challenge_id: challengeId, purpose: PROOF_PURPOSE })
        .catch(() => {
          throw new Error('Could not sign the marketplace grant proof');
        });
      const response = await post('/v1/auth/grant-sessions', proof);
      const parsed = sessionSchema.safeParse(response.body);
      if (response.status !== 201 || !parsed.success) {
        // The response may contain a real bearer even when another field is malformed.
        const revocable = revocationSchema.safeParse(response.body);
        return withCleanup(
          () => {
            throw new Error('Marketplace returned an invalid grant session');
          },
          async () => {
            if (revocable.success)
              await revokeMinted(base, { token: revocable.data.token, sessionId: revocable.data.session_id });
          },
        );
      }
      minted = {
        token: parsed.data.token,
        sessionId: parsed.data.session_id,
        pubky: parsed.data.pubky,
        capabilities: parsed.data.capabilities,
        expiresAt: parsed.data.expires_at,
      };
      if (
        minted.pubky !== expectedPubky ||
        !acceptedCapabilities.some(
          (caps) => normalizedCapabilities(caps) === normalizedCapabilities(minted.capabilities),
        )
      ) {
        const rejected = minted;
        return withCleanup(
          () => {
            throw new Error('Marketplace returned a grant session for an unexpected account or capability set');
          },
          async () => {
            await revokeMinted(base, rejected);
            minted = undefined;
          },
        );
      }
      return minted;
    },
    async () => {
      try {
        await session.storage.delete(proofPath);
      } catch {
        // Do not orphan a bearer that the caller will never receive after a cleanup failure.
        await withCleanup(
          () => {
            throw new Error('Could not delete the marketplace grant proof');
          },
          async () => {
            if (minted) await revokeMinted(base, minted);
          },
        );
      }
    },
  );
}

/**
 * Owns a temporary root storage grant and ends it after minting the narrowed service bearer.
 * clientId must be enabled in the target service's MARKETPLACE_GRANT_SESSION_CLIENT_IDS.
 * @param {{ client: import('@synonymdev/pubky').Pubky, keypair: import('@synonymdev/pubky').Keypair,
 *   clientId: string, serviceUrl: string, acceptedCapabilities?: readonly string[] }} options
 */
export async function mintMarketplaceGrantSessionForSigner({
  client,
  keypair,
  clientId,
  serviceUrl,
  acceptedCapabilities,
}) {
  // Blocking sign-in can fail on PKDNS publication after minting but before returning the grant.
  // Take ownership as soon as the SDK can return it, so cleanup can always retire it.
  const session = await client.signer(keypair).signin(clientId);
  let minted;
  return withCleanup(
    async () => {
      minted = await mintMarketplaceGrantSession({
        session,
        expectedPubky: keypair.publicKey.z32(),
        serviceUrl,
        acceptedCapabilities,
      });
      return minted;
    },
    async () => {
      try {
        await session.signout();
      } catch {
        await withCleanup(
          () => {
            throw new Error('Could not end the temporary homeserver grant session');
          },
          async () => {
            if (minted) await revokeMinted(serviceUrl.replace(/\/+$/, ''), minted);
          },
        );
      }
    },
  );
}
