import { webcrypto } from 'node:crypto';
import { GrantAuthFlow, Pubky } from '@synonymdev/pubky';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const shopKeyMarkers = () => Object.keys(localStorage).filter((name) => name.startsWith('shop-owned-grant-v1:key:'));

/** Relay requests still open, by method. The SDK long-polls with GET and acknowledges an approval with DELETE. */
const openRelayRequests = new Map<string, number>();
const relayRequests: string[] = [];
const openCount = () => [...openRelayRequests.values()].reduce((sum, count) => sum + count, 0);

let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = (next: 'visible' | 'hidden') => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

/**
 * iOS Safari suspends a hidden page and WebKit aborts its in-flight work, so a live SDK flow must not hold the
 * relay channel there: its listener would take the approval off the relay and the grant exchange would run in
 * the background. Exercised with the real SDK, whose listener is dropped when the flow is freed.
 */
describe('Shop grant flow on a hidden iOS page (real SDK)', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      relayRequests.push(method);
      openRelayRequests.set(method, (openRelayRequests.get(method) ?? 0) + 1);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          openRelayRequests.set(method, (openRelayRequests.get(method) ?? 1) - 1);
          reject(new DOMException('The fixture relay was canceled', 'AbortError'));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    });
    installWebLocks();
    localStorage.clear();
  });

  afterEach(async () => {
    await vi.waitFor(() => expect(openCount()).toBe(0));
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    removeWebLocks();
  });

  it('drops the relay poll while hidden without acknowledging, then resumes the same channel once visible', async () => {
    const resumeDelegated = vi.spyOn(GrantAuthFlow, 'resumeDelegated');
    const resumeLocal = vi.spyOn(Pubky.prototype, 'resumeGrantAuthFlow');
    const flow = await HomeserverService.generateGrantAuthUrl();
    flow.awaitApproval.catch(() => {});
    try {
      await vi.waitFor(() => expect(openRelayRequests.get('GET')).toBe(1));

      // Handing off to Bitkit: the open long-poll is aborted and nothing can acknowledge an approval.
      setVisibility('hidden');
      await vi.waitFor(() => expect(openCount()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(openCount()).toBe(0);
      expect(relayRequests).not.toContain('DELETE');
      expect(resumeDelegated).not.toHaveBeenCalled();

      // Back in Safari: the same channel and key are resumed and the relay is polled again.
      setVisibility('visible');
      await vi.waitFor(() => expect(resumeDelegated).toHaveBeenCalledOnce(), { timeout: 5000 });
      const resumed = (await resumeDelegated.mock.results[0].value) as GrantAuthFlow;
      expect(resumed.authorizationUrl).toBe(flow.authorizationUrl);
      await vi.waitFor(() => expect(openRelayRequests.get('GET')).toBe(1));
      expect(relayRequests).not.toContain('DELETE');
      expect(resumeLocal).not.toHaveBeenCalled();
    } finally {
      flow.cancelAuthFlow();
      resumeDelegated.mockRestore();
      resumeLocal.mockRestore();
    }
    await vi.waitFor(() => expect(shopKeyMarkers()).toEqual([]));
  });
});
