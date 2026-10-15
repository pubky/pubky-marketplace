import type { GrantSession } from '@synonymdev/pubky';
import { z } from 'zod';
import { getMarketplaceUrl } from '@/config/commerce';
import { isAppError } from '@/libs/error/error';
import { safeFetch } from '@/libs/error/error.http';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { marketplaceApprovalFailure } from './marketplace-approval-failure';
import { marketplaceSessionIdSchema } from './marketplace-session-id';

/** Signed `data.purpose` the service requires (marketplace-service `grant_session.rs`). */
export const GRANT_SESSION_PROOF_PURPOSE = 'marketplace-service/grant-session/v1';
/** `domain` of the homeserver proof document. */
export const GRANT_SESSION_PROOF_DOMAIN = 'marketplace-service/grant-session-proof/v1';
/** The proof document lives here, followed by the challenge id. */
export const GRANT_SESSION_PROOFS_PATH = '/pub/pubky.app/marketplace/v1/session-proofs/';

const OPERATION = 'marketplaceGrantSession';

const responseSchema = z.object({
  token: z.string(),
  session_id: marketplaceSessionIdSchema,
  pubky: z.string(),
  capabilities: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
});

export type MintedGrantSession = {
  token: string;
  sessionId: string;
  pubky: string;
  capabilities: string;
  expiresAt: string;
};

function failure(code: string, status?: number) {
  return marketplaceApprovalFailure(code, OPERATION, status);
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as unknown;
  const code =
    typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'grant_session_unavailable';
  return /^[a-z_]{1,64}$/.test(code) ? code : 'grant_session_unavailable';
}

/**
 * Mints a marketplace session from the Shop's own sign-in grant, with no
 * signer approval. The grant session writes a single-use proof document to
 * its homeserver (only a live, unrevoked session can), signs a custom proof
 * over the same challenge with the grant's client key, and the service
 * verifies both before issuing a bearer narrowed to the marketplace scopes.
 * The proof document is deleted whatever the outcome.
 */
export class MarketplaceGrantSessionService {
  private constructor() {}

  static async mint({ grant, pubky }: { grant: GrantSession; pubky: string }): Promise<MintedGrantSession> {
    const serviceUrl = getMarketplaceUrl();
    const audience = new URL(serviceUrl).origin;
    const challengeId = crypto.randomUUID();
    const proofUri = `pubky://${pubky}${GRANT_SESSION_PROOFS_PATH}${challengeId}`;
    try {
      try {
        await HomeserverService.request({
          method: HttpMethod.PUT,
          url: proofUri,
          bodyJson: { aud: audience, challenge_id: challengeId, domain: GRANT_SESSION_PROOF_DOMAIN, pubky },
        });
      } catch (error) {
        // The grant session could not write its own homeserver: it expired or was revoked.
        if (isAppError(error) && error.category === ErrorCategory.Auth) throw failure('shop_session_expired');
        throw error;
      }
      const proof = await grant.createCustomPop({
        aud: audience,
        challenge_id: challengeId,
        purpose: GRANT_SESSION_PROOF_PURPOSE,
      });
      const response = await safeFetch(
        `${serviceUrl}/v1/auth/grant-sessions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant: proof.grant, pop: proof.pop }),
          cache: 'no-store',
        },
        ErrorService.Marketplace,
        OPERATION,
      );
      if (!response.ok) throw failure(await errorCode(response), response.status);
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.pubky !== pubky) throw failure('grant_invalid_response', response.status);
      return {
        token: parsed.data.token,
        sessionId: parsed.data.session_id,
        pubky: parsed.data.pubky,
        capabilities: parsed.data.capabilities,
        expiresAt: parsed.data.expires_at,
      };
    } finally {
      await HomeserverService.delete(proofUri).catch(() => {
        Logger.warn('Could not delete the grant session proof document');
      });
    }
  }

  /**
   * Revokes a marketplace session at the service. Best effort: sign-out must
   * not wait on or fail with the network, and the service TTL still bounds a
   * session this call could not reach.
   */
  static async revoke({ token, sessionId }: { token: string; sessionId: string }): Promise<void> {
    await fetch(`${getMarketplaceUrl()}/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => {
      Logger.warn('Could not revoke the marketplace session at sign-out');
    });
  }
}
