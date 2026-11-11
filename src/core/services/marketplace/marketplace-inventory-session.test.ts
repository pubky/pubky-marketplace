import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import captured from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import { INVENTORY_GRANT, INVENTORY_SESSION_STORAGE_KEY } from './marketplace-inventory-grant';
import { MarketplaceInventorySessionService } from './marketplace-inventory-session';
import { MARKETPLACE_SESSION_STORAGE_KEY, MarketplaceSessionService } from './marketplace-session';

const PUBKY = 'y'.repeat(52);
const TOKEN = 'A'.repeat(43);
const INVENTORY_TOKEN = 'I'.repeat(43);

const config = vi.hoisted(() => ({
  mode: 'transaction-service' as string,
}));

// These transport tests do not exercise homeserver IO. Avoid the SDK's global fetch wrapper.
vi.mock('@/services/homeserver/homeserver', () => ({ HomeserverService: {} }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => config.mode,
    getMarketplaceUrl: () => 'http://127.0.0.1:8080',
  };
});

function inOneDay(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}

/** Historical records are restored through the same validation as an existing browser. */
function establishIdentity(capabilities = captured.parity_request.homeserver_verified): void {
  window.localStorage.setItem(
    MARKETPLACE_SESSION_STORAGE_KEY,
    JSON.stringify({
      token: TOKEN,
      pubky: PUBKY,
      capabilities,
      expiresAt: inOneDay(),
    }),
  );
  MarketplaceSessionService.restorePersistedSession(PUBKY);
}

function restoreInventory(capabilities: string = INVENTORY_GRANT, sessionId = '11111111-1111-4111-8111-111111111111') {
  window.localStorage.setItem(
    INVENTORY_SESSION_STORAGE_KEY,
    JSON.stringify({
      token: INVENTORY_TOKEN,
      pubky: PUBKY,
      capabilities,
      expiresAt: inOneDay(),
      sessionId,
    }),
  );
  return MarketplaceInventorySessionService.restorePersistedSession(PUBKY);
}

describe('MarketplaceInventorySessionService', () => {
  beforeEach(() => {
    config.mode = 'transaction-service';
    MarketplaceInventorySessionService.clearSession();
    MarketplaceSessionService.clearSession();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the inventory grant without overwriting the purchase bearer or exposing a token', () => {
    establishIdentity();
    const identityBefore = window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);
    const info = restoreInventory();

    expect(info?.capabilities).toBe(INVENTORY_GRANT);
    expect(info).not.toHaveProperty('token');
    expect(MarketplaceSessionService.getActiveSession()?.token).toBe(TOKEN);
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBe(identityBefore);
    expect(MarketplaceInventorySessionService.getActiveSession()?.token).toBe(INVENTORY_TOKEN);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revert-fail: keeps a migration-0035 inventory session id through restore', () => {
    const legacySessionId = 'c91ac604-4109-a63d-ab8b-327fc9decd05';
    expect(z.uuid().safeParse(legacySessionId).success).toBe(false);
    expect(restoreInventory(INVENTORY_GRANT, legacySessionId)?.pubky).toBe(PUBKY);
    expect(MarketplaceInventorySessionService.getActiveSession()?.sessionId).toBe(legacySessionId);
  });

  it.each(['', 'a'.repeat(37), 'abc\n', 'ab\u0000c', 'ab\u007Fc'])(
    'rejects a persisted inventory session id outside the wire format: %j',
    (sessionId) => {
      expect(restoreInventory(INVENTORY_GRANT, sessionId)).toBeNull();
      expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
      expect(window.localStorage.getItem(INVENTORY_SESSION_STORAGE_KEY)).toBeNull();
    },
  );

  it('restores an existing inventory approval independently of the purchase session', () => {
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    expect(restoreInventory()?.pubky).toBe(PUBKY);
    expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)).toEqual({
      token: INVENTORY_TOKEN,
      source: 'inventory',
    });
  });

  it('does not clear inventory when the purchase session is dropped', () => {
    establishIdentity();
    restoreInventory();
    MarketplaceSessionService.clearSession('rejected');
    expect(MarketplaceInventorySessionService.getActiveSession()?.token).toBe(INVENTORY_TOKEN);
  });

  it('clears only the inventory slot', () => {
    establishIdentity();
    restoreInventory();
    MarketplaceInventorySessionService.clearSession('rejected');
    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
    expect(MarketplaceSessionService.getActiveSession()?.token).toBe(TOKEN);
  });

  it('normalizes padded stored capabilities to the inventory grant', () => {
    expect(restoreInventory(` ${INVENTORY_GRANT} `)?.capabilities).toBe(INVENTORY_GRANT);
    expect(MarketplaceInventorySessionService.getActiveSession()?.capabilities).toBe(INVENTORY_GRANT);
  });

  it.each(['/:rw', `${INVENTORY_GRANT},/:rw`, '', '/pub/pubky.app/marketplace-service/v1/:r'])(
    'removes an inventory record with unapproved capabilities: %s',
    (capabilities) => {
      expect(restoreInventory(capabilities)).toBeNull();
      expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
      expect(window.localStorage.getItem(INVENTORY_SESSION_STORAGE_KEY)).toBeNull();
    },
  );

  describe('getCoveringBearer', () => {
    it.each([
      ['the Bitkit parity grant', captured.parity_request.homeserver_verified],
      ['the previous service grant', captured.previous_request.homeserver_verified],
      ['the Shop sign-in grant', captured.shop_signin_request.homeserver_verified],
    ])('uses the purchase session when it carries %s', (_label, capabilities) => {
      establishIdentity(capabilities);

      expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)).toEqual({ token: TOKEN, source: 'purchase' });
    });

    it.each([
      ['an empty grant', ''],
      ['an unapproved root grant', '/:rw'],
      ['read only', '/pub/pubky.app/marketplace-service/v1/:r'],
      ['a narrower tree', '/pub/pubky.app/marketplace-service/v1/listings/:rw'],
      ['a sibling tree', '/pub/pubky.app/marketplace-service/v2/:rw'],
      ['only /priv', '/priv/pubky.app/:rw'],
      ['a path without a trailing slash', '/pub/pubky.app/marketplace-service:rw'],
      ['unknown actions', '/pub/pubky.app/marketplace-service/v1/:rwx'],
      ['repeated actions', '/pub/pubky.app/marketplace-service/v1/:rrw'],
    ])('needs a Studio grant when the purchase session carries %s', (_label, capabilities) => {
      establishIdentity(capabilities);

      expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)).toBeNull();
    });

    it('never returns a purchase bearer for another pubky', () => {
      establishIdentity(captured.parity_request.homeserver_verified);

      expect(MarketplaceInventorySessionService.getCoveringBearer('z'.repeat(52))).toBeNull();
    });

    it('prefers the Studio session and clears only the session the service refused', () => {
      establishIdentity(captured.parity_request.homeserver_verified);
      restoreInventory();

      const studio = MarketplaceInventorySessionService.getCoveringBearer(PUBKY);
      expect(studio).toEqual({ token: INVENTORY_TOKEN, source: 'inventory' });
      MarketplaceInventorySessionService.clearRejectedBearer(studio!);
      expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
      expect(MarketplaceSessionService.getActiveSession()?.token).toBe(TOKEN);

      const purchase = MarketplaceInventorySessionService.getCoveringBearer(PUBKY);
      expect(purchase).toEqual({ token: TOKEN, source: 'purchase' });
      MarketplaceInventorySessionService.clearRejectedBearer(purchase!);
      expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    });
  });
});
