import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import captured from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import { INVENTORY_GRANT, INVENTORY_SESSION_STORAGE_KEY } from './marketplace-inventory-grant';
import { MarketplaceInventorySessionService } from './marketplace-inventory-session';
import { MarketplaceSessionService } from './marketplace-session';

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'http://127.0.0.1:8080',
  };
});

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantFlowEnabled: () => false,
}));

const PUBKY = 'y'.repeat(52);
const OTHER_ACCOUNT = 'z'.repeat(52);
const THIS_TAB = { token: 'I'.repeat(43), sessionId: '11111111-1111-4111-8111-111111111111' };
const OTHER_TAB = { token: 'J'.repeat(43), sessionId: '22222222-2222-4222-8222-222222222222' };
const HOUR = 3_600_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function mintResponse(ttlMs: number): Response {
  return new Response(
    JSON.stringify({
      token: THIS_TAB.token,
      session_id: THIS_TAB.sessionId,
      pubky: PUBKY,
      capabilities: INVENTORY_GRANT,
      expires_at: iso(Date.now() + ttlMs),
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
}

/** This tab mints a Studio bearer expiring in `ttlMs` through the real writer. */
async function thisTabHolds(ttlMs: number) {
  MarketplaceSessionService.establishClaimedGrantSession(
    {
      token: 'A'.repeat(43),
      pubky: PUBKY,
      capabilities: captured.parity_request.homeserver_verified,
      expiresAt: iso(Date.now() + 48 * HOUR),
    },
    PUBKY,
  );
  fetchSpy.mockResolvedValueOnce(mintResponse(ttlMs));
  return await MarketplaceInventorySessionService.mintInventorySession(new Uint8Array([1]), PUBKY);
}

/** Another tab's writer leaves its Studio bearer in the shared slot. */
function otherTabPersists(ttlMs: number, pubky = PUBKY): string {
  const blob = JSON.stringify({
    ...OTHER_TAB,
    pubky,
    capabilities: INVENTORY_GRANT,
    expiresAt: iso(Date.now() + ttlMs),
  });
  window.localStorage.setItem(INVENTORY_SESSION_STORAGE_KEY, blob);
  return blob;
}

function stored(): string | null {
  return window.localStorage.getItem(INVENTORY_SESSION_STORAGE_KEY);
}

/** A reload: fresh module state, same shared `localStorage`. */
async function reloadedService() {
  vi.resetModules();
  const reloaded = await import('./marketplace-inventory-session');
  return reloaded.MarketplaceInventorySessionService;
}

let fetchSpy: MockInstance<typeof fetch>;

const SERVICE = 'http://127.0.0.1:8080';

function serviceRevokes(): Array<{ url: string; bearer: string }> {
  return fetchSpy.mock.calls
    .filter(([url, init]) => init?.method === 'DELETE' && String(url).includes('/v1/auth/sessions/'))
    .map(([url, init]) => ({
      url: String(url),
      bearer: String((init?.headers as Record<string, string>).authorization),
    }));
}

describe('inventory-session persistence: a tab only removes the record it owns', () => {
  beforeEach(() => {
    MarketplaceInventorySessionService.clearForSignOut();
    MarketplaceSessionService.clearForSignOut();
    window.localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('expiry in this tab keeps the newer bearer another tab persisted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await thisTabHolds(HOUR);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    const newer = otherTabPersists(24 * HOUR);

    vi.setSystemTime(Date.now() + 30 * 60_000);
    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();

    expect(stored()).toBe(newer);
  });

  it('old memory at its expiry margin with a newer valid record: restore adopts it and it survives the next reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await thisTabHolds(HOUR);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    const newer = otherTabPersists(24 * HOUR);
    vi.setSystemTime(Date.now() + 30 * 60_000);

    expect(MarketplaceInventorySessionService.restorePersistedSession(PUBKY)?.capabilities).toBe(INVENTORY_GRANT);
    expect(MarketplaceInventorySessionService.getActiveSession()?.token).toBe(OTHER_TAB.token);
    expect(stored()).toBe(newer);

    const afterReload = await reloadedService();
    afterReload.restorePersistedSession(PUBKY);
    expect(afterReload.getActiveSession()?.token).toBe(OTHER_TAB.token);
  });

  it('expiry still removes this tab’s own record', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await thisTabHolds(HOUR);
    vi.setSystemTime(Date.now() + HOUR);

    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('a refusal for the Studio bearer a request carried never clears a newer session adopted meanwhile', async () => {
    await thisTabHolds(HOUR);
    const newer = otherTabPersists(24 * HOUR);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + HOUR);
    MarketplaceInventorySessionService.restorePersistedSession(PUBKY);

    MarketplaceInventorySessionService.clearRejectedBearer({ token: THIS_TAB.token, source: 'inventory' });

    expect(MarketplaceInventorySessionService.getActiveSession()?.token).toBe(OTHER_TAB.token);
    expect(stored()).toBe(newer);
  });

  it('a refusal for the current Studio bearer removes it and only its record', async () => {
    await thisTabHolds(HOUR);
    MarketplaceInventorySessionService.clearRejectedBearer({ token: THIS_TAB.token, source: 'inventory' });
    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('an explicit clear in this tab leaves another tab’s newer record', async () => {
    await thisTabHolds(HOUR);
    const newer = otherTabPersists(24 * HOUR);
    MarketplaceInventorySessionService.clearSession('cleared');
    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
    expect(stored()).toBe(newer);
  });

  it('a clear with nothing in memory removes nothing', () => {
    const newer = otherTabPersists(24 * HOUR);
    MarketplaceInventorySessionService.clearSession('cleared');
    expect(stored()).toBe(newer);
  });

  it('a mint that lands after another tab persisted a later-expiring bearer does not overwrite it', async () => {
    const newer = otherTabPersists(24 * HOUR);
    await thisTabHolds(HOUR);
    expect(MarketplaceInventorySessionService.getActiveSession()?.token).toBe(THIS_TAB.token);
    expect(stored()).toBe(newer);
  });

  it('a mint overwrites an older record', async () => {
    otherTabPersists(HOUR);
    await thisTabHolds(24 * HOUR);
    expect(JSON.parse(stored()!)).toMatchObject({ token: THIS_TAB.token });
  });

  it('restore leaves another account’s record in place', () => {
    const foreign = otherTabPersists(24 * HOUR, OTHER_ACCOUNT);
    expect(MarketplaceInventorySessionService.restorePersistedSession(PUBKY)).toBeNull();
    expect(stored()).toBe(foreign);
  });

  it('restore drops an expired record it read, and only that record', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const expired = otherTabPersists(10_000);
    vi.setSystemTime(Date.now() + 20_000);
    expect(stored()).toBe(expired);
    expect(MarketplaceInventorySessionService.restorePersistedSession(PUBKY)).toBeNull();
    expect(stored()).toBeNull();
  });

  it('sign-out removes whatever Studio bearer is at rest', async () => {
    await thisTabHolds(HOUR);
    otherTabPersists(24 * HOUR);

    MarketplaceInventorySessionService.clearForSignOut();

    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('sign-out revokes the Studio bearer in memory and the one another tab persisted, once each', async () => {
    await thisTabHolds(HOUR);
    otherTabPersists(24 * HOUR);
    fetchSpy.mockClear();

    MarketplaceInventorySessionService.clearForSignOut();

    expect(serviceRevokes()).toEqual([
      { url: `${SERVICE}/v1/auth/sessions/${THIS_TAB.sessionId}`, bearer: `Bearer ${THIS_TAB.token}` },
      { url: `${SERVICE}/v1/auth/sessions/${OTHER_TAB.sessionId}`, bearer: `Bearer ${OTHER_TAB.token}` },
    ]);
  });

  it('sign-out revokes a Studio bearer that is only at rest', () => {
    otherTabPersists(24 * HOUR);
    fetchSpy.mockClear();

    MarketplaceInventorySessionService.clearForSignOut();

    expect(serviceRevokes()).toEqual([
      { url: `${SERVICE}/v1/auth/sessions/${OTHER_TAB.sessionId}`, bearer: `Bearer ${OTHER_TAB.token}` },
    ]);
    expect(stored()).toBeNull();
  });

  it('an account switch revokes the departed account’s Studio bearer and keeps the staying one', async () => {
    otherTabPersists(24 * HOUR, OTHER_ACCOUNT);
    fetchSpy.mockClear();
    MarketplaceInventorySessionService.clearOtherAccounts(PUBKY);
    expect(serviceRevokes().map(({ bearer }) => bearer)).toEqual([`Bearer ${OTHER_TAB.token}`]);
    expect(stored()).toBeNull();

    await thisTabHolds(HOUR);
    fetchSpy.mockClear();
    MarketplaceInventorySessionService.clearOtherAccounts(PUBKY);
    expect(serviceRevokes()).toEqual([]);
    expect(MarketplaceInventorySessionService.getActiveSession()).toMatchObject({ token: THIS_TAB.token });
  });
});
