import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CAPABILITIES } from '@/config/app';
import captured from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import ringCookie from '@/test/fixtures/auth/ring-cookie-signin.pubky-common-0.11.json';
import { MARKETPLACE_SESSION_STORAGE_KEY, MarketplaceSessionService } from './marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from './marketplace-session-grant';

const PUBKY = 'y'.repeat(52);
const TOKEN = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const TOKEN_C = 'C'.repeat(43);

const config = vi.hoisted(() => ({
  mode: 'transaction-service' as string,
  grantSessions: false,
}));

vi.mock('@/libs/runtime-config/runtime-config', async (original) => ({
  ...(await original<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantSessionEnabled: () => config.grantSessions,
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

/** md5(encode(token_hash, 'hex')) hyphenated, token hash 43. Version nibble `a`, the 17–20 Sep capture class. */
const LEGACY_SESSION_ID = 'c91ac604-4109-a63d-ab8b-327fc9decd05';

function inOneDay(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}

function installSession(expiresAt = inOneDay(), token = TOKEN, capabilities = MARKETPLACE_SESSION_GRANT) {
  return MarketplaceSessionService.establishClaimedGrantSession(
    { token, pubky: PUBKY, capabilities, expiresAt },
    PUBKY,
  );
}

/** Simulates a page reload: the in-memory session dies, localStorage survives. */
function dropMemoryOnly() {
  const persisted = window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);
  MarketplaceSessionService.clearSession();
  if (persisted !== null) {
    window.localStorage.setItem(MARKETPLACE_SESSION_STORAGE_KEY, persisted);
  }
}

describe('MarketplaceSessionService', () => {
  beforeEach(() => {
    config.mode = 'transaction-service';
    MarketplaceSessionService.clearSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never hands the bearer token to callers of the grant installer', () => {
    const info = installSession();
    expect(info).not.toHaveProperty('token');
    expect(JSON.stringify(info)).not.toContain(TOKEN);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('persists the session to localStorage only — never sessionStorage or IndexedDB', async () => {
    const sessionSetItemSpy = vi.spyOn(window.sessionStorage, 'setItem');
    const indexedDbOpenSpy = vi.spyOn(indexedDB, 'open');
    installSession(inOneDay());

    const persisted = window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!)).toMatchObject({ token: TOKEN, pubky: PUBKY });
    expect(sessionSetItemSpy).not.toHaveBeenCalled();
    expect(indexedDbOpenSpy).not.toHaveBeenCalled();
    sessionSetItemSpy.mockRestore();
    indexedDbOpenSpy.mockRestore();
  });

  it('revert-fail: keeps a migration-0035 session id through a claimed grant and restore', () => {
    expect(z.uuid().safeParse(LEGACY_SESSION_ID).success).toBe(false);
    MarketplaceSessionService.establishClaimedGrantSession(
      {
        token: TOKEN,
        sessionId: LEGACY_SESSION_ID,
        pubky: PUBKY,
        capabilities: MARKETPLACE_SESSION_GRANT,
        expiresAt: inOneDay(),
      },
      PUBKY,
    );
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ sessionId: LEGACY_SESSION_ID });

    dropMemoryOnly();
    MarketplaceSessionService.restorePersistedSession(PUBKY);
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({
      sessionId: LEGACY_SESSION_ID,
      capabilities: MARKETPLACE_SESSION_GRANT,
    });
  });

  it.each(['', 'a'.repeat(37), 'abc\n', 'ab\u0000c', 'ab\u007Fc'])(
    'rejects invalid claimed session id %j without replacing an existing session',
    (sessionId) => {
      installSession();
      const persisted = window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);
      expect(() =>
        MarketplaceSessionService.establishClaimedGrantSession(
          { token: TOKEN_B, sessionId, pubky: PUBKY, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt: inOneDay() },
          PUBKY,
        ),
      ).toThrow();
      expect(MarketplaceSessionService.getActiveSession()?.token).toBe(TOKEN);
      expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBe(persisted);
    },
  );

  it.each(['not-a-session-token', 'A'.repeat(42), 'A'.repeat(44), '+'.repeat(43)])(
    'rejects a claimed bearer outside the service wire format: %s',
    (token) => {
      expect(() => installSession(inOneDay(), token)).toThrow();
      expect(MarketplaceSessionService.getActiveSession()).toBeNull();
      expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();
    },
  );

  it.each(['invalid', '2026-99-99T00:00:00Z'])('rejects invalid claimed expiry %s', (expiresAt) => {
    expect(() => installSession(expiresAt)).toThrow();
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('restores a persisted session for the matching account across a simulated reload', async () => {
    installSession(inOneDay(), TOKEN, MARKETPLACE_SESSION_GRANT);

    dropMemoryOnly();
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();

    const info = MarketplaceSessionService.restorePersistedSession(PUBKY);

    expect(info).toMatchObject({ pubky: PUBKY });
    expect(info).not.toHaveProperty('token');
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN, pubky: PUBKY });
  });

  it.each([
    ['the Ring cookie sign-in set', ringCookie.service_normalized],
    ['the current Shop grant', CAPABILITIES],
    ['the pre-chat Shop sign-in grant', '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw'],
  ])('restores a historical persisted session carrying %s', async (_label, capabilities) => {
    window.localStorage.setItem(
      MARKETPLACE_SESSION_STORAGE_KEY,
      JSON.stringify({
        token: TOKEN,
        pubky: PUBKY,
        capabilities,
        expiresAt: inOneDay(),
      }),
    );

    expect(MarketplaceSessionService.restorePersistedSession(PUBKY)).toMatchObject({ pubky: PUBKY });
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN, capabilities });
  });

  it('never adopts a persisted session that belongs to another account, and leaves it for its owner', async () => {
    installSession(inOneDay());
    dropMemoryOnly();
    const persisted = window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);

    expect(MarketplaceSessionService.restorePersistedSession('z'.repeat(52))).toBeNull();
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBe(persisted);
  });

  it('drops a persisted session that is past the expiry margin or malformed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    installSession('2026-08-20T13:00:00.000Z');
    dropMemoryOnly();

    vi.setSystemTime(new Date('2026-08-20T12:59:31.000Z'));
    expect(MarketplaceSessionService.restorePersistedSession(PUBKY)).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(MARKETPLACE_SESSION_STORAGE_KEY, 'not json');
    expect(MarketplaceSessionService.restorePersistedSession(PUBKY)).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('refuses to restore outside durable modes even when a blob is persisted', async () => {
    installSession(inOneDay());
    dropMemoryOnly();
    config.mode = 'sandbox';

    expect(MarketplaceSessionService.restorePersistedSession(PUBKY)).toBeNull();
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
  });

  it('treats a session as absent once it reaches the expiry margin, and re-establishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    installSession('2026-08-20T13:00:00.000Z', TOKEN);
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN });

    // 30s before the server-side expiry the client already refuses to use it.
    vi.setSystemTime(new Date('2026-08-20T12:59:31.000Z'));
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();

    installSession('2026-08-20T14:00:00.000Z', TOKEN_B);
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN_B });
  });

  it('clears the session from memory AND localStorage on demand', async () => {
    installSession(inOneDay());
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).not.toBeNull();

    MarketplaceSessionService.clearSession();

    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('notifies onSessionEnded with expired, rejected, and cleared reasons', async () => {
    const reasons: string[] = [];
    const unsubscribe = MarketplaceSessionService.onSessionEnded((event) => {
      reasons.push(event.reason);
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    installSession('2026-08-20T13:00:00.000Z');
    vi.setSystemTime(new Date('2026-08-20T12:59:31.000Z'));
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    await Promise.resolve();
    expect(reasons).toEqual(['expired']);

    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    installSession('2026-08-20T13:00:00.000Z');
    MarketplaceSessionService.clearSession('rejected');
    await Promise.resolve();
    expect(reasons).toEqual(['expired', 'rejected']);

    installSession('2026-08-20T13:00:00.000Z');
    MarketplaceSessionService.clearSession();
    await Promise.resolve();
    expect(reasons).toEqual(['expired', 'rejected', 'cleared']);

    MarketplaceSessionService.clearSession();
    await Promise.resolve();
    expect(reasons).toEqual(['expired', 'rejected', 'cleared']);
    unsubscribe();
  });

  it('establishes a claimed grant session for the signed-in account', () => {
    const expiresAt = inOneDay();
    const info = MarketplaceSessionService.establishClaimedGrantSession(
      { token: TOKEN, pubky: PUBKY, capabilities: MARKETPLACE_SESSION_GRANT, expiresAt },
      PUBKY,
    );
    expect(info).toMatchObject({ pubky: PUBKY, expiresAt });
    expect(info).not.toHaveProperty('token');
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN, pubky: PUBKY });
  });

  it('rejects a claimed grant session for a different account without storing it', () => {
    expect(() =>
      MarketplaceSessionService.establishClaimedGrantSession(
        { token: TOKEN, pubky: PUBKY, capabilities: '', expiresAt: inOneDay() },
        'z'.repeat(52),
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('MarketplaceSessionService sign-out revoke', () => {
  const SESSION_ID = '22222222-2222-4222-8222-222222222222';

  afterEach(() => {
    config.grantSessions = false;
    vi.unstubAllGlobals();
  });

  function holdSession(sessionId?: string) {
    MarketplaceSessionService.establishClaimedGrantSession(
      {
        token: TOKEN,
        sessionId,
        pubky: PUBKY,
        capabilities: MARKETPLACE_SESSION_GRANT,
        expiresAt: inOneDay(),
      },
      PUBKY,
    );
  }

  function revokeCall() {
    return [
      `http://127.0.0.1:8080/v1/auth/sessions/${SESSION_ID}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN}` },
        cache: 'no-store',
        keepalive: true,
      },
    ];
  }

  it.each([
    ['grant sessions on', true],
    ['grant sessions off', false],
  ])('revokes the session at the service on sign-out with %s', (_label, grantSessions) => {
    config.grantSessions = grantSessions;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    holdSession(SESSION_ID);
    MarketplaceSessionService.clearForSignOut();
    expect(fetchMock.mock.calls).toEqual([revokeCall()]);
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
  });

  it('has nothing to revoke for a session the service issued without an id', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    holdSession();
    MarketplaceSessionService.clearForSignOut();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MarketplaceSessionService replacement guard (staging grant shapes)', () => {
  const parity = captured.parity_request.homeserver_verified;
  const previous = captured.previous_request.homeserver_verified;
  const shopGrant = captured.shop_signin_request.homeserver_verified;
  const signIn = ringCookie.service_normalized;

  beforeEach(() => {
    config.mode = 'transaction-service';
    MarketplaceSessionService.clearSession();
  });

  async function holdWideSession(): Promise<string | null> {
    MarketplaceSessionService.establishClaimedGrantSession(
      { token: TOKEN, pubky: PUBKY, capabilities: parity, expiresAt: inOneDay() },
      PUBKY,
    );
    return window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY);
  }

  function expectWideSessionKept(persisted: string | null) {
    expect(MarketplaceSessionService.getActiveSession()).toMatchObject({ token: TOKEN, capabilities: parity });
    expect(window.localStorage.getItem(MARKETPLACE_SESSION_STORAGE_KEY)).toBe(persisted);
  }

  it.each([
    ['empty', '', 'unexpected_capabilities'],
    ['inventory-only over parity', previous, 'narrower_than_current'],
    ['extra scope', `${parity},/pub/paykit/:rw`, 'unexpected_capabilities'],
    ['private-data only', '/priv/pubky.app/:rw', 'unexpected_capabilities'],
    ['root', '/:rw', 'unexpected_capabilities'],
    ['Shop sign-in grant', shopGrant, 'unexpected_capabilities'],
    ['Ring cookie sign-in set', signIn, 'unexpected_capabilities'],
    ['duplicated entry', `${previous},${previous}`, 'unexpected_capabilities'],
    ['malformed', 'garbage', 'unexpected_capabilities'],
  ])('a claimed %s grant is refused and the current session kept', async (_label, capabilities, rejection) => {
    const persisted = await holdWideSession();
    expect(() =>
      MarketplaceSessionService.establishClaimedGrantSession(
        { token: TOKEN_C, pubky: PUBKY, capabilities, expiresAt: inOneDay() },
        PUBKY,
      ),
    ).toThrow(expect.objectContaining({ category: 'validation', context: { rejection } }));
    expectWideSessionKept(persisted);
  });

  it('accepts the marketplace grant in the normalized order returned by the service', () => {
    const capabilities = parity.split(',').reverse().join(',');
    const info = MarketplaceSessionService.establishClaimedGrantSession(
      { token: TOKEN_B, pubky: PUBKY, capabilities, expiresAt: inOneDay() },
      PUBKY,
    );
    expect(info.pubky).toBe(PUBKY);
    expect(MarketplaceSessionService.getActiveSession()?.token).toBe(TOKEN_B);
  });
});
