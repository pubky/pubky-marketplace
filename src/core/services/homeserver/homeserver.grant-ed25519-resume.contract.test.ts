import { webcrypto } from 'node:crypto';
import { GrantAuthFlow, Pubky } from '@synonymdev/pubky';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';

const shopKeyMarkers = () => Object.keys(localStorage).filter((name) => name.startsWith('shop-owned-grant-v1:key:'));

let relayOnline = true;
/** Relay requests still open; a freed flow's background poll must end before the next test changes the relay. */
let openRelayRequests = 0;

/**
 * Resume of a delegated (WebCrypto Ed25519) flow with the real SDK. Kept apart from
 * `homeserver.grant-ed25519.contract.test.ts`: SDK 0.16.1 can panic in WASM when an
 * earlier delegated flow in the same module was freed with work still in flight.
 */
describe('Shop delegated grant flow resume (real SDK)', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!relayOnline) return Promise.reject(new TypeError('Failed to fetch'));
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      openRelayRequests += 1;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          openRelayRequests -= 1;
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
    await vi.waitFor(() => expect(openRelayRequests).toBe(0));
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    removeWebLocks();
  });

  it('resumes a pending delegated flow from its saved key after the relay drops', async () => {
    const resumeDelegated = vi.spyOn(GrantAuthFlow, 'resumeDelegated');
    const resumeLocal = vi.spyOn(Pubky.prototype, 'resumeGrantAuthFlow');
    relayOnline = false;
    const flow = await HomeserverService.generateGrantAuthUrl();
    flow.awaitApproval.catch(() => {});
    try {
      await vi.waitFor(() => expect(resumeDelegated).toHaveBeenCalled(), { timeout: 5000 });
      const resumed = (await resumeDelegated.mock.results[0].value) as GrantAuthFlow;
      expect(resumed.authorizationUrl).toBe(flow.authorizationUrl);
      expect(resumeLocal).not.toHaveBeenCalled();
    } finally {
      relayOnline = true;
      flow.cancelAuthFlow();
      resumeDelegated.mockRestore();
      resumeLocal.mockRestore();
    }
    await vi.waitFor(() => expect(shopKeyMarkers()).toEqual([]));
  });
});
