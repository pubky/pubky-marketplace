// @vitest-environment node
import { createHmac } from 'node:crypto';
import type { EncryptionKeys, Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from '@/config/app';
import { encryptPrivRecord, privEntryName, privEntryUrl, privFamilyUrl } from '@/libs/commerce/priv-envelope';
import { privKeyringFromResponse } from '@/libs/commerce/priv-keys';
import { HttpMethod } from '@/libs/http/http.types';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from '@/services/marketplace/marketplace-session-grant';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  PRIV_KEYS_WIRE_CUSTODY_RELEASED,
  PRIV_KEYS_WIRE_OK,
  PRIV_KEYS_WIRE_OWNER,
  PRIV_KEYS_WIRE_RELEASE_OK,
} from '@/test/fixtures/commerce/priv-keys.wire';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';
import { CommercePrivKeyringApplication } from './priv-keyring';

/**
 * The first keyed read after the owner takes custody of the `/priv` data
 * keys (S5 of the Phase 4 staging proof). The marketplace service still holds
 * the key and the watchlist document is sealed under it; the owner's signer
 * delivered scoped encryption keys. The first sync wraps the key, has the
 * service drop its copy, and must then read the watchlist with the keyring it
 * just verified, not come back empty and wait for a reload.
 *
 * Real: the sync, the keyring holder, the wrapped-keys store, the private
 * store and its crypto, the marketplace gateway, Dexie. Stubbed: `fetch` (the
 * service's wire bodies), the homeserver transport, and the signer's
 * `EncryptionKeys` (a deriver that refuses use after `free()`, like the wasm
 * object).
 */

const OWNER = PRIV_KEYS_WIRE_OWNER;
const MARKETPLACE_URL = 'https://marketplace.keyed-first-sync.test';
const SELLER = 'n'.repeat(52);
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

/** A session approved with scoped encryption keys: every grant read hands out fresh, freeable copies. */
function keyedSession() {
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
  const session = {
    info: { publicKey: { z32: () => OWNER }, capabilities: CAPABILITIES.split(',') },
    get grant() {
      return { encryptionKeys: asOpaque<EncryptionKeys>(makeKeys()), free: () => undefined };
    },
  };
  return asOpaque<Session>(session);
}

describe('the first keyed sync after the owner takes custody of the data keys', () => {
  let homeserver: FakeHomeserver;
  let serviceReleased: boolean;
  let requests: string[];

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
        const url = new URL(typeof input === 'string' ? input : input.toString());
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
    MarketplaceSessionService.establishClaimedGrantSession(
      { token: 'C'.repeat(43), pubky: OWNER, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt: FUTURE },
      OWNER,
    );
    useAuthStore.setState({ currentUserPubky: asOpaque(OWNER), session: keyedSession() });
    CommercePrivKeyringApplication.clear();
    CommerceApplication.resetWatchlistSyncInFlight();
  });

  afterEach(() => {
    MarketplaceSessionService.clearSession();
    CommercePrivKeyringApplication.clear();
    CommerceApplication.resetWatchlistSyncInFlight();
    useAuthStore.setState({ currentUserPubky: null, session: null });
    removeWebLocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE;
    delete process.env.PUBKY_RUNTIME_MARKETPLACE_URL;
    resetRuntimeConfigForTests();
  });

  function sealWatchlistUnderServiceKey() {
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

  it('reads and merges the watchlist in the same round that released custody', async () => {
    sealWatchlistUnderServiceKey();

    const status = await CommerceApplication.syncWatchlist(OWNER);

    expect(requests).toContain('POST /v1/me/priv-keys/release');
    expect(homeserver.log.some((entry) => entry.startsWith('GET ') && entry.includes('/priv/'))).toBe(true);
    expect(status).toBe('synced');

    // The directory the first keyed pass reads is the one the Ring session wrote.
    const ringDirectory = privFamilyUrl(serviceKeyring(), 'watchlist');
    const firstPass = await CommercePrivKeyringApplication.get(OWNER);
    if (firstPass.kind !== 'keys') throw new Error('no keys after the release');
    expect(privFamilyUrl(firstPass.keyring, 'watchlist')).toBe(ringDirectory);
    expect(homeserver.log.filter((entry) => entry.startsWith('GET ') && entry.includes(ringDirectory))).not.toEqual([]);
    CommercePrivKeyringApplication.clear();
    const reload = await CommercePrivKeyringApplication.get(OWNER);
    if (reload.kind !== 'keys') throw new Error('no keys after a reload');
    expect(privFamilyUrl(reload.keyring, 'watchlist')).toBe(ringDirectory);
    const favorites = await LocalCommerceService.getFavorites(OWNER);
    expect(favorites.map((favorite) => favorite.listing_id)).toEqual([`${SELLER}:boots_01`]);
  });

  it('still reads the watchlist when the purchase session is replaced while custody is being released', async () => {
    sealWatchlistUnderServiceKey();
    const parked = homeserver.holdNext(HttpMethod.PUT, /\/v2\/keys\//);

    const sync = CommerceApplication.syncWatchlist(OWNER);
    await parked.reached;
    MarketplaceSessionService.establishClaimedGrantSession(
      { token: 'D'.repeat(43), pubky: OWNER, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt: FUTURE },
      OWNER,
    );
    parked.release();

    expect(await sync).toBe('synced');
    expect(requests).toContain('POST /v1/me/priv-keys/release');
    const favorites = await LocalCommerceService.getFavorites(OWNER);
    expect(favorites.map((favorite) => favorite.listing_id)).toEqual([`${SELLER}:boots_01`]);
  });

  it('gives no keys to a round that outlives a sign-out', async () => {
    sealWatchlistUnderServiceKey();
    const parked = homeserver.holdNext(HttpMethod.PUT, /\/v2\/keys\//);

    const sync = CommerceApplication.syncWatchlist(OWNER);
    await parked.reached;
    MarketplaceSessionService.clearSession();
    parked.release();

    expect(await sync).toBe('needs_marketplace_approval');
    expect(await LocalCommerceService.getFavorites(OWNER)).toEqual([]);
  });

  it('runs the round again for a caller that joined one that started before the purchase session existed', async () => {
    sealWatchlistUnderServiceKey();
    MarketplaceSessionService.clearSession();
    let proceed: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    vi.spyOn(CommercePrivKeyringApplication, 'get').mockImplementationOnce(async () => {
      await gate;
      return { kind: 'needs_reauth' };
    });

    const early = CommerceApplication.syncWatchlist(OWNER);
    MarketplaceSessionService.establishClaimedGrantSession(
      { token: 'C'.repeat(43), pubky: OWNER, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt: FUTURE },
      OWNER,
    );
    const joined = CommerceApplication.syncWatchlist(OWNER);
    proceed();

    expect(await early).toBe('needs_marketplace_approval');
    expect(await joined).toBe('synced');
    const favorites = await LocalCommerceService.getFavorites(OWNER);
    expect(favorites.map((favorite) => favorite.listing_id)).toEqual([`${SELLER}:boots_01`]);
  });

  it('runs the round again for a caller that joined one that ended while another reader took custody of the keys', async () => {
    sealWatchlistUnderServiceKey();
    let proceed: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const realGet = CommercePrivKeyringApplication.get.bind(CommercePrivKeyringApplication);
    vi.spyOn(CommercePrivKeyringApplication, 'get').mockImplementationOnce(async () => {
      await gate;
      return { kind: 'needs_reauth' };
    });

    const early = CommerceApplication.syncWatchlist(OWNER);
    const joined = CommerceApplication.syncWatchlist(OWNER);
    const otherReader = realGet(OWNER);
    await otherReader;
    proceed();

    expect(await early).toBe('needs_marketplace_approval');
    expect(await joined).toBe('synced');
    expect(requests).toContain('POST /v1/me/priv-keys/release');
  });
});
