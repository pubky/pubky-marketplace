import { z } from 'zod';
import { withBasePath } from '@/config/base-path';
import { getMarketplaceUrl } from '@/config/commerce';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { parseRetryAfterHeader } from '@/libs/http/response.utils';
import { normalizeValidStoreClaimCode } from '@/libs/store-claim/store-claim-code';
import { MarketplaceSessionService } from './marketplace-session';

const OPERATION = 'storeClaim';

const stateSchema = z.object({
  kind: z.enum(['unclaimed', 'unavailable', 'claimed']),
  seller: z.string().nullable(),
  source: z.enum(['pinned', 'claim']).nullable(),
});

export type ResolvedStoreState = z.infer<typeof stateSchema>;

export type StoreClaimResult =
  | { kind: 'success' }
  | { kind: 'invalid-code' }
  | { kind: 'stale-session' }
  | { kind: 'session-rejected' }
  | { kind: 'session-source' }
  | { kind: 'session-capability' }
  | { kind: 'already-claimed'; seller: string | null }
  | { kind: 'retry-later'; retryAfterSeconds?: number };

function reason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { error?: { reason?: unknown } }).error?.reason;
  return typeof value === 'string' ? value : null;
}

function seller(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const direct = (body as { seller?: unknown }).seller;
  if (typeof direct === 'string') return direct;
  const store = (body as { store?: { seller?: unknown } }).store;
  return typeof store?.seller === 'string' ? store.seller : null;
}

export class MarketplaceStoreClaimService {
  private constructor() {}

  static async claim(claimCode: string, pubky: string): Promise<StoreClaimResult> {
    const code = normalizeValidStoreClaimCode(claimCode);
    if (!code) return { kind: 'invalid-code' };
    const session = MarketplaceSessionService.getActiveSession();
    if (!session || session.pubky !== pubky) return { kind: 'stale-session' };
    const response = await safeFetch(
      `${getMarketplaceUrl()}/v1/store/claim`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ claim_code: code }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      },
      ErrorService.Marketplace,
      OPERATION,
    );
    if (response.ok) return { kind: 'success' };

    const body = (await response.json().catch(() => null)) as unknown;
    if (response.status === 401) return { kind: 'session-rejected' };
    if (response.status === 403) {
      switch (reason(body)) {
        case 'claim_code_invalid':
          return { kind: 'invalid-code' };
        case 'claim_session_stale':
          return { kind: 'stale-session' };
        case 'claim_session_source':
          return { kind: 'session-source' };
        case 'claim_session_capability':
          return { kind: 'session-capability' };
      }
    }
    if (response.status === 409) return { kind: 'already-claimed', seller: seller(body) };
    if (response.status === 429 || response.status === 503) {
      return { kind: 'retry-later', retryAfterSeconds: parseRetryAfterHeader(response.headers.get('retry-after')) };
    }
    throw httpResponseToError(response, ErrorService.Marketplace, OPERATION, `${getMarketplaceUrl()}/v1/store/claim`);
  }

  static async fetchStoreState(fresh = false): Promise<ResolvedStoreState> {
    const path = `/api/marketplace/store${fresh ? '?fresh=1' : ''}`;
    const response = await safeFetch(
      withBasePath(path),
      { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' },
      ErrorService.Marketplace,
      'fetchStoreState',
    );
    if (!response.ok) {
      throw httpResponseToError(response, ErrorService.Marketplace, 'fetchStoreState', withBasePath(path));
    }
    const parsed = stateSchema.safeParse(await response.json());
    if (!parsed.success) return { kind: 'unavailable', seller: null, source: null };
    return parsed.data;
  }
}
