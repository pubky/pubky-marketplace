/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from './bff';
import type { MarketplaceGrantConfig } from './config';
import { hashBoundCookie, makeBoundCookie, parseBoundCookie, sealBearer } from './crypto';
import type { BridgeRow } from './db';

const ORIGIN = 'https://shop.example';

const bridges = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  getBridge: vi.fn(),
  deleteBridge: vi.fn(),
  deleteBridgeForSession: vi.fn(),
}));

const config: MarketplaceGrantConfig = vi.hoisted(() => ({
  allowedOrigins: ['https://shop.example'],
  publicOrigin: 'https://shop.example',
  serviceUrl: 'https://service.example',
  databaseUrl: 'postgres://example',
  cronSecret: 'c'.repeat(32),
  assertionIssuer: 'https://shop.example',
  assertionKeyId: 'shop-bff-test-0001',
  assertionKeyEpoch: 1,
  assertionSigningKey: '11'.repeat(32),
  requestKeyId: 'shop-bff-test-request-0001',
  requestKeyEpoch: 1,
  requestSigningKey: '22'.repeat(32),
  stateKey: Buffer.alloc(32, 3).toString('base64'),
  stateKeyEpoch: 1,
  stateTtlSeconds: 300,
  claimLeaseSeconds: 25,
  databaseTimeoutMs: 2000,
  serviceTimeoutMs: 5000,
}));

vi.mock('./config', () => ({
  getMarketplaceGrantConfig: () => config,
}));

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  getBridge: bridges.getBridge,
  deleteBridge: bridges.deleteBridge,
  deleteBridgeForSession: bridges.deleteBridgeForSession,
}));

const THIS_TAB_SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_TAB_SESSION = '22222222-2222-4222-8222-222222222222';
const BRIDGE_ID = '33333333-3333-4333-8333-333333333333';

function request(query = ''): Request {
  return new Request(`${ORIGIN}/api/marketplace/session${query}`, {
    method: 'DELETE',
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
  });
}

describe('BFF session unpair is scoped to the marketplace session a tab owns', () => {
  const cookie = makeBoundCookie(BRIDGE_ID).value;

  beforeEach(() => {
    bridges.rows = new Map([[BRIDGE_ID, OTHER_TAB_SESSION]]);
    bridges.getBridge.mockReset().mockResolvedValue(null);
    bridges.deleteBridge.mockReset().mockImplementation(async (_config: unknown, id: string) => {
      bridges.rows.delete(id);
    });
    bridges.deleteBridgeForSession
      .mockReset()
      .mockImplementation(async (_config: unknown, id: string, sessionId: string) => {
        if (bridges.rows.get(id) === sessionId) {
          bridges.rows.delete(id);
          return true;
        }
        return !bridges.rows.has(id);
      });
  });

  it('keeps another tab’s newer pairing and its cookie when this tab’s session expires', async () => {
    const cleared = await clearSession(request(`?session_id=${THIS_TAB_SESSION}`), cookie);

    expect(cleared).toBe(false);
    expect(bridges.rows.get(BRIDGE_ID)).toBe(OTHER_TAB_SESSION);
    expect(bridges.deleteBridge).not.toHaveBeenCalled();
    expect(bridges.deleteBridgeForSession).toHaveBeenCalledWith(expect.anything(), BRIDGE_ID, THIS_TAB_SESSION);
  });

  it('unpairs the bridge when it still holds this tab’s session', async () => {
    bridges.rows.set(BRIDGE_ID, THIS_TAB_SESSION);
    expect(await clearSession(request(`?session_id=${THIS_TAB_SESSION}`), cookie)).toBe(true);
    expect(bridges.rows.has(BRIDGE_ID)).toBe(false);
  });

  it('sign-out (no session id) unpairs whatever the cookie names', async () => {
    expect(await clearSession(request(), cookie)).toBe(true);
    expect(bridges.deleteBridge).toHaveBeenCalledWith(expect.anything(), BRIDGE_ID);
    expect(bridges.deleteBridgeForSession).not.toHaveBeenCalled();
  });

  it('refuses a malformed session id before touching a bridge', async () => {
    await expect(clearSession(request('?session_id=not%0Aan-id'), cookie)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(bridges.deleteBridge).not.toHaveBeenCalled();
    expect(bridges.deleteBridgeForSession).not.toHaveBeenCalled();
  });
});

describe('BFF sign-out revokes the marketplace session the bridge holds', () => {
  const BEARER = 'K'.repeat(43);
  const PUBKY = 'y'.repeat(52);
  const parsedBridgeCookie = makeBoundCookie(BRIDGE_ID);

  function bridgeFor(cookieValue: string, bearer = BEARER, sessionId = THIS_TAB_SESSION): BridgeRow {
    const parsed = parseBoundCookie(cookieValue)!;
    return {
      bridge_id: BRIDGE_ID,
      cookie_hash: hashBoundCookie(config, config.stateKeyEpoch, 'session', BRIDGE_ID, parsed.secret),
      pubky: PUBKY,
      marketplace_session_id: sessionId,
      bearer_sealed: sealBearer(config, BRIDGE_ID, sessionId, PUBKY, bearer),
      key_epoch: config.stateKeyEpoch,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 3_600_000),
      last_verified_at: new Date(),
    };
  }

  beforeEach(() => {
    bridges.getBridge.mockReset().mockResolvedValue(bridgeFor(parsedBridgeCookie.value));
    bridges.deleteBridge.mockReset().mockResolvedValue(undefined);
    bridges.deleteBridgeForSession.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('revokes the paired session with its own bearer, then drops the bridge and cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    expect(await clearSession(request(), parsedBridgeCookie.value)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://service.example/v1/auth/sessions/${THIS_TAB_SESSION}`);
    expect(init).toMatchObject({ method: 'DELETE', headers: { authorization: `Bearer ${BEARER}` } });
    expect(bridges.deleteBridge).toHaveBeenCalledWith(expect.anything(), BRIDGE_ID);
  });

  it('still drops the bridge and the cookie when the service refuses or does not answer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await clearSession(request(), parsedBridgeCookie.value)).toBe(true);
    expect(bridges.deleteBridge).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await clearSession(request(), parsedBridgeCookie.value)).toBe(true);
    expect(bridges.deleteBridge).toHaveBeenCalledTimes(2);
  });

  it('does not open the bearer for a cookie that does not match the bridge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    bridges.getBridge.mockResolvedValue(bridgeFor(makeBoundCookie(BRIDGE_ID).value));

    expect(await clearSession(request(), parsedBridgeCookie.value)).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bridges.deleteBridge).toHaveBeenCalledWith(expect.anything(), BRIDGE_ID);
  });

  it('still drops a bridge whose sealed bearer cannot be opened', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    bridges.getBridge.mockResolvedValue({
      ...bridgeFor(parsedBridgeCookie.value),
      bearer_sealed: new Uint8Array(64),
    });

    expect(await clearSession(request(), parsedBridgeCookie.value)).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bridges.deleteBridge).toHaveBeenCalledTimes(1);
  });

  it('leaves the service session alone when a tab only unpairs the one it owns', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    bridges.deleteBridgeForSession.mockResolvedValue(true);

    await clearSession(request(`?session_id=${THIS_TAB_SESSION}`), parsedBridgeCookie.value);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bridges.getBridge).not.toHaveBeenCalled();
  });
});
