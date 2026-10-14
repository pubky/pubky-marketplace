import { createHmac } from 'node:crypto';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { EncryptionKeys, Session } from '@synonymdev/pubky';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommercePrivKeyringApplication } from '@/application/commerce/priv-keyring';
import { CAPABILITIES } from '@/config/app';
import { CommerceController } from '@/controllers/commerce/commerce';
import { encryptPrivRecord, privEntryName, privEntryUrl } from '@/libs/commerce/priv-envelope';
import { privKeyringFromResponse } from '@/libs/commerce/priv-keys';
import { HttpMethod } from '@/libs/http/http.types';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from '@/services/marketplace/marketplace-session-grant';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import {
  PRIV_KEYS_WIRE_CUSTODY_RELEASED,
  PRIV_KEYS_WIRE_OK,
  PRIV_KEYS_WIRE_OWNER,
  PRIV_KEYS_WIRE_RELEASE_OK,
} from '@/test/fixtures/commerce/priv-keys.wire';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { MarketplaceWatchlist } from './MarketplaceWatchlist';

/**
 * Phase 4 staging proof, S5 on fresh seats: a Ring session wrote a watchlist
 * entry (sealed under the key the marketplace service holds), the same
 * account then signs in with a Bitkit grant that carries scoped encryption
 * keys, connects the marketplace, and opens the watchlist for the first time.
 * That first visit takes custody of the keys (wrap, read back, release) and
 * must show the entry without a reload.
 *
 * Real: the watchlist template and its hooks, the sync, the keyring holder,
 * the wrapped-keys store, the private store and crypto, the marketplace
 * gateway and session service, Dexie and the stores. Stubbed: `fetch` (the
 * service's wire bodies), the homeserver transport, and the signer's
 * `EncryptionKeys` (a deriver that refuses use after `free()`).
 */

const OWNER = PRIV_KEYS_WIRE_OWNER;
const SELLER = 'n'.repeat(52);
const MARKETPLACE_URL = 'https://marketplace.keyed-first-visit.test';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serviceKeyring() {
  const keyring = privKeyringFromResponse(
    {
      schemaVersion: 1,
      owner: PRIV_KEYS_WIRE_OK.owner,
      currentKeyId: PRIV_KEYS_WIRE_OK.current_key_id,
      keys: PRIV_KEYS_WIRE_OK.keys.map((key) => ({ keyId: key.key_id, key: key.key, createdAt: key.created_at })),
    } as never,
    OWNER,
  );
  if (!keyring) throw new Error('the wire fixture does not parse into a keyring');
  return keyring;
}

function keyedSession(): Session {
  const freed: boolean[] = [];
  const makeKeys = () => {
    const index = freed.push(false) - 1;
    return {
      scopes: ['/priv/pubky.app/marketplace/'],
      free: () => {
        freed[index] = true;
      },
      deriveForPath(path: string): Uint8Array {
        if (freed[index]) throw new Error('null pointer passed to rust');
        return new Uint8Array(createHmac('sha256', 'signer-root').update(path).digest());
      },
    };
  };
  return asOpaque<Session>({
    info: { publicKey: { z32: () => OWNER }, capabilities: CAPABILITIES.split(',') },
    get grant() {
      return { encryptionKeys: asOpaque<EncryptionKeys>(makeKeys()), free: () => undefined };
    },
  });
}

function renderWatchlist() {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  };
  return render(
    <AppRouterContext.Provider value={asOpaque(router)}>
      <PathnameContext.Provider value="/marketplace/watchlist">
        <PathParamsContext.Provider value={{}}>
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <MarketplaceWatchlist />
          </SearchParamsContext.Provider>
        </PathParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

describe('first watchlist visit after the owner took custody of the data keys (S5, nothing mocked)', () => {
  let homeserver: FakeHomeserver;
  let serviceReleased: boolean;
  let requests: string[];

  function connectMarketplace(token: string) {
    const session = MarketplaceSessionService.establishClaimedGrantSession(
      { token, pubky: OWNER, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt: FUTURE },
      OWNER,
    );
    CommerceController.writeMarketplaceSessionStore(session);
  }

  function ringWroteWatchlist() {
    const keyring = serviceKeyring();
    const now = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      recordType: 'watchlist',
      ownerPubky: OWNER,
      revision: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: now,
      items: [{ listingOwnerPubky: SELLER, listingId: 'boots_01', watchedAtMs: Date.now() - 1000 }],
      tombstones: [],
    };
    const name = privEntryName(keyring, 'watchlist', 'watchlist');
    homeserver.files.set(
      privEntryUrl(keyring, 'watchlist', 'watchlist'),
      encryptPrivRecord({ keyring, family: 'watchlist', name, record }),
    );
  }

  beforeEach(() => {
    process.env.PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE = 'transaction-service';
    process.env.PUBKY_RUNTIME_MARKETPLACE_URL = MARKETPLACE_URL;
    resetRuntimeConfigForTests();
    homeserver = installFakeHomeserver();
    installWebLocks();
    serviceReleased = false;
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.toString(), 'https://shop.test');
        const method = (init.method ?? 'GET').toUpperCase();
        requests.push(`${method} ${url.pathname}`);
        if (url.pathname === '/v1/me/priv-keys' && method === 'GET') {
          return serviceReleased ? json(409, PRIV_KEYS_WIRE_CUSTODY_RELEASED) : json(200, PRIV_KEYS_WIRE_OK);
        }
        if (url.pathname === '/v1/me/priv-keys/release' && method === 'POST') {
          serviceReleased = true;
          return json(200, PRIV_KEYS_WIRE_RELEASE_OK);
        }
        return json(404, { error: 'not_found' });
      }),
    );
    MarketplaceSessionService.clearSession();
    CommercePrivKeyringApplication.clear();
    CommerceApplication.resetWatchlistSyncInFlight();
    useCommerceStore.getState().setMarketplaceSession(null);
    useCommerceStore.getState().setWatchlistSyncStatus('idle');
    useAuthStore.setState({ currentUserPubky: asOpaque(OWNER), session: keyedSession() });
  });

  afterEach(() => {
    MarketplaceSessionService.clearSession();
    CommercePrivKeyringApplication.clear();
    CommerceApplication.resetWatchlistSyncInFlight();
    useCommerceStore.getState().setMarketplaceSession(null);
    useAuthStore.setState({ currentUserPubky: null, session: null });
    removeWebLocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE;
    delete process.env.PUBKY_RUNTIME_MARKETPLACE_URL;
    resetRuntimeConfigForTests();
  });

  it('shows the Ring-written entry on the first visit when the marketplace was connected before it', async () => {
    ringWroteWatchlist();
    await CommerceController.syncWatchlist();
    expect(useCommerceStore.getState().watchlistSyncStatus).toBe('needs_marketplace_approval');
    connectMarketplace('C'.repeat(43));

    renderWatchlist();
    void CommerceController.syncAttentionSeen();

    expect(await screen.findByText(/1 watched item/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(requests).toContain('POST /v1/me/priv-keys/release');
  });

  it('shows the entry when the marketplace session only appears after the watchlist mounted', async () => {
    ringWroteWatchlist();
    renderWatchlist();
    expect(await screen.findByText(/0 watched items/)).toBeInTheDocument();
    expect(useCommerceStore.getState().watchlistSyncStatus).toBe('needs_marketplace_approval');

    await act(async () => {
      connectMarketplace('C'.repeat(43));
      void CommerceController.syncAttentionSeen();
    });

    expect(await screen.findByText(/1 watched item/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(requests).toContain('POST /v1/me/priv-keys/release');
  });

  it('shows the entry when the sign-in sync is still releasing custody as the marketplace is connected and the watchlist opened', async () => {
    ringWroteWatchlist();
    connectMarketplace('R'.repeat(43));
    const parked = homeserver.holdNext(HttpMethod.PUT, /\/v2\/keys\//);

    const signInSync = CommerceController.syncWatchlist();
    await parked.reached;
    connectMarketplace('C'.repeat(43));
    renderWatchlist();
    void CommerceController.syncAttentionSeen();
    parked.release();
    await signInSync;

    expect(await screen.findByText(/1 watched item/, undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});
