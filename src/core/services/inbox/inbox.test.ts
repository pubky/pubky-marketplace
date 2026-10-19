import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import { INBOX_SESSION_STORAGE_KEY, InboxService } from '@/services/inbox/inbox';

const ME = 'm'.repeat(52);
const PEER = 'p'.repeat(52);
const config = vi.hoisted(() => ({
  inboxUrl: 'https://inbox.test' as string | null,
  inboxAudience: null as string | null,
}));

vi.mock('@/libs/runtime-config/runtime-config', async () => {
  const actual = await vi.importActual<typeof import('@/libs/runtime-config/runtime-config')>(
    '@/libs/runtime-config/runtime-config',
  );
  return {
    ...actual,
    getInboxUrl: () => config.inboxUrl,
    getInboxAudience: () => config.inboxAudience ?? config.inboxUrl,
  };
});

type Call = { url: string; init: RequestInit };

function installFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return await handler({ url, init });
  });
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const credentials = async () => ({ grant: 'GRANT', pop: 'POP' });
const future = new Date(Date.now() + 3_600_000).toISOString();

describe('InboxService', () => {
  beforeEach(() => {
    config.inboxUrl = 'https://inbox.test';
    config.inboxAudience = null;
    window.localStorage.clear();
    InboxService.clearSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is disabled without a configured URL and without credentials', async () => {
    config.inboxUrl = null;
    expect(InboxService.isConfigured()).toBe(false);
    expect(await InboxService.ensureSession(ME, credentials)).toBe('disabled');
    config.inboxUrl = 'https://inbox.test';
    installFetch(() => json(500, {}));
    expect(await InboxService.ensureSession(ME, async () => null)).toBe('disabled');
  });

  it('establishes a session with the audience proof, persists it and reuses it', async () => {
    const calls = installFetch(() => json(201, { access_token: 'TOKEN', expires_at: future }));
    const seen: unknown[] = [];
    expect(
      await InboxService.ensureSession(ME, async (data) => {
        seen.push(data);
        return credentials();
      }),
    ).toBe('ready');
    expect(seen).toEqual([{ type: 'pubky-inbox-session-v1', audience: 'https://inbox.test' }]);
    expect(calls[0].url).toBe('https://inbox.test/v1/auth/session');
    expect(JSON.parse(window.localStorage.getItem(INBOX_SESSION_STORAGE_KEY) ?? '{}')).toMatchObject({
      pubky: ME,
      token: 'TOKEN',
    });

    expect(await InboxService.ensureSession(ME, credentials)).toBe('ready');
    expect(calls).toHaveLength(1);
  });

  it('sends, waits for and acknowledges pings with the bearer', async () => {
    const calls = installFetch(({ url }) => {
      if (url.endsWith('/v1/auth/session')) return json(201, { access_token: 'TOKEN', expires_at: future });
      if (url.includes('/v1/pings?')) {
        return json(200, {
          pings: [
            { sender: PEER, slot: 'chat-x', revision: 'r1', received_at: 'now', expires_at: 'later', payload: 'hi' },
          ],
        });
      }
      return new Response(null, { status: 204 });
    });
    await InboxService.ensureSession(ME, credentials);
    await InboxService.ping(ME, { slot: 'chat-x', recipient: PEER, payload: 'hello', ttlSeconds: 60 });
    const pings = await InboxService.waitForPings(ME, { limit: 10, waitSeconds: 5 });
    await InboxService.ack(ME, pings);

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      'POST https://inbox.test/v1/auth/session',
      'POST https://inbox.test/v1/pings',
      'GET https://inbox.test/v1/pings?limit=10&wait=5',
      'POST https://inbox.test/v1/pings/ack',
    ]);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      slot: 'chat-x',
      recipient: PEER,
      payload: 'hello',
      ttl_seconds: 60,
    });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({
      pings: [{ sender: PEER, slot: 'chat-x', revision: 'r1' }],
    });
  });

  it('refuses slots outside the Base64url alphabet before sending', async () => {
    const calls = installFetch(() => json(201, { access_token: 'TOKEN', expires_at: future }));
    await InboxService.ensureSession(ME, credentials);
    await expect(
      InboxService.ping(ME, { slot: 'chat:x', recipient: PEER, payload: 'hello', ttlSeconds: 60 }),
    ).rejects.toThrow(/Base64url/u);
    expect(calls.filter((call) => call.url.endsWith('/v1/pings'))).toHaveLength(0);
  });

  it('refuses oversize payloads before sending', async () => {
    installFetch(() => json(201, { access_token: 'TOKEN', expires_at: future }));
    await InboxService.ensureSession(ME, credentials);
    await expect(
      InboxService.ping(ME, { slot: 'chat-x', recipient: PEER, payload: 'x'.repeat(513), ttlSeconds: 60 }),
    ).rejects.toThrow(/512/u);
  });

  it('drops the session on 401 so the next ensureSession re-establishes it', async () => {
    let sessions = 0;
    installFetch(({ url }) => {
      if (url.endsWith('/v1/auth/session')) {
        sessions += 1;
        return json(201, { access_token: `TOKEN${sessions}`, expires_at: future });
      }
      return new Response(null, { status: 401 });
    });
    await InboxService.ensureSession(ME, credentials);
    await expect(InboxService.ping(ME, { slot: 's', recipient: PEER, payload: 'x', ttlSeconds: 1 })).rejects.toThrow();
    expect(window.localStorage.getItem(INBOX_SESSION_STORAGE_KEY)).toBeNull();
    await InboxService.ensureSession(ME, credentials);
    expect(sessions).toBe(2);
  });

  it('forgets other accounts and expired sessions', async () => {
    window.localStorage.setItem(
      INBOX_SESSION_STORAGE_KEY,
      JSON.stringify({ pubky: PEER, token: 'OLD', expiresAt: future }),
    );
    InboxService.clearSessionsOfOtherAccounts(ME);
    expect(window.localStorage.getItem(INBOX_SESSION_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(
      INBOX_SESSION_STORAGE_KEY,
      JSON.stringify({ pubky: ME, token: 'OLD', expiresAt: new Date(Date.now() - 1).toISOString() }),
    );
    const calls = installFetch(() => json(201, { access_token: 'NEW', expires_at: future }));
    expect(await InboxService.ensureSession(ME, credentials)).toBe('ready');
    expect(calls).toHaveLength(1);
  });

  describe('an inbox that is not up', () => {
    const refused = () => {
      throw new TypeError('Failed to fetch');
    };

    it('reports unavailable without an error event, holds off retries and recovers by itself', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-19T09:00:00Z'));
      const error = vi.spyOn(Logger, 'error');
      const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      let up = false;
      const calls = installFetch(() => {
        if (!up) return refused();
        return json(201, { access_token: 'TOKEN', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
      });

      expect(await InboxService.ensureSession(ME, credentials)).toBe('unavailable');
      expect(calls).toHaveLength(1);

      // Every caller (the leader loop, each outbox flush, each reconcile pass) is answered from the schedule.
      for (let pass = 0; pass < 6; pass += 1) {
        vi.advanceTimersByTime(400);
        expect(await InboxService.ensureSession(ME, credentials)).toBe('unavailable');
      }
      expect(calls).toHaveLength(1);

      // Retries come back, spaced further apart, and the outage is logged once.
      for (let minutes = 0; minutes < 30; minutes += 1) {
        vi.advanceTimersByTime(60_000);
        await InboxService.ensureSession(ME, credentials);
      }
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.length).toBeLessThanOrEqual(10);
      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);

      up = true;
      vi.advanceTimersByTime(10 * 60_000);
      expect(await InboxService.ensureSession(ME, credentials)).toBe('ready');
      expect(await InboxService.ensureSession(ME, credentials)).toBe('ready');
      expect(error).not.toHaveBeenCalled();
    });

    it.each([404, 502, 503, 504])('treats a host that answers %i as not up', async (status) => {
      const error = vi.spyOn(Logger, 'error');
      vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      installFetch(() => new Response('nope', { status }));
      expect(await InboxService.ensureSession(ME, credentials)).toBe('unavailable');
      expect(error).not.toHaveBeenCalled();
    });

    it('gives up on a request that never answers instead of holding the outbox lock', async () => {
      vi.useFakeTimers();
      vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      vi.stubGlobal(
        'fetch',
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = InboxService.ensureSession(ME, credentials);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toBe('unavailable');
    });

    it('still raises a misconfiguration the operator must fix', async () => {
      for (const status of [400, 401, 403]) {
        InboxService.clearSession();
        installFetch(() => json(status, { error: { code: 'rejected' } }));
        await expect(InboxService.ensureSession(ME, credentials)).rejects.toThrow();
      }
    });
  });
});
