import { MarketplaceGrantSessionService } from './marketplace-grant-session';
import { marketplaceSessionIdSchema } from './marketplace-session-id';

/**
 * A bearer this browser held for the marketplace service, as read from memory
 * or from the persisted record. `sessionId` and `expiresAtMs` come from
 * storage that another tab or an older Shop wrote, so both are untrusted.
 */
export type HeldMarketplaceBearer = {
  token: string;
  sessionId?: unknown;
  expiresAtMs?: number;
};

/**
 * Ends every distinct held bearer at the service. Sign-out and account switch
 * use it: removing a bearer from the browser does not end it at the service,
 * where it stays valid until `AUTH_SESSION_TTL_SECONDS` (24 hours) and is
 * otherwise usable by anyone who copied it. A bearer without a session id (a
 * service that predates the id) cannot be addressed and is left to expire, as
 * is one whose expiry has already passed. Best effort and never throws:
 * sign-out must not wait on or fail with the network.
 */
export function revokeHeldMarketplaceSessions(held: readonly (HeldMarketplaceBearer | null)[]): void {
  const seen = new Set<string>();
  for (const bearer of held) {
    if (!bearer || seen.has(bearer.token)) continue;
    seen.add(bearer.token);
    const sessionId = marketplaceSessionIdSchema.safeParse(bearer.sessionId);
    if (!sessionId.success) continue;
    if (bearer.expiresAtMs !== undefined && bearer.expiresAtMs > 0 && bearer.expiresAtMs <= Date.now()) continue;
    void MarketplaceGrantSessionService.revoke({ token: bearer.token, sessionId: sessionId.data });
  }
}
