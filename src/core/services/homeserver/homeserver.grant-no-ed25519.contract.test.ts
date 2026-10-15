import { webcrypto } from 'node:crypto';
import { AuthFlowKind, GrantAuthFlow, Keypair, Pubky, PublicKey } from '@synonymdev/pubky';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, getShopGrantClientId } from '@/config/app';
import { getDefaultHttpRelay } from '@/config/network';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';
import { pendingOwnedGrants } from './owned-grant-storage';

vi.mock('@/config/network', async (original) => ({
  ...(await original<object>()),
  getHomeserver: () => Keypair.random().publicKey.z32(),
}));

const isEd25519 = (algorithm: unknown): boolean => {
  const name = typeof algorithm === 'string' ? algorithm : (algorithm as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.toLowerCase() === 'ed25519';
};

const unsupported = () => Promise.reject(new DOMException('Unrecognized name.', 'NotSupportedError'));

const shopMarkers = () => Object.keys(localStorage).filter((name) => name.startsWith('shop-owned-grant-v1:'));

let relayOnline = true;
/** Relay requests still open; a freed flow's background poll must end before the next test changes the relay. */
let openRelayRequests = 0;

/**
 * A browser whose WebCrypto has no Ed25519 (Chrome before 137, e.g. Chrome 124): secure context,
 * IndexedDB and Web Locks are all there, but every Ed25519 generate, import or sign rejects.
 * The SDK caches its Ed25519 probe per module instance, so this file only covers that browser.
 */
describe('Shop grant sign-in without WebCrypto Ed25519 (real SDK)', () => {
  const subtle = webcrypto.subtle;
  let ed25519Attempts = 0;

  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('isSecureContext', true);
    // Grant flows long-poll the relay from creation; a relay with no approval yet never answers.
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
    for (const method of ['generateKey', 'importKey', 'sign'] as const) {
      const native = (subtle[method] as (...args: unknown[]) => unknown).bind(subtle);
      const algorithmAt = method === 'importKey' ? 2 : 0;
      vi.spyOn(subtle, method).mockImplementation(((...args: unknown[]) => {
        if (!isEd25519(args[algorithmAt])) return native(...args);
        ed25519Attempts += 1;
        return unsupported();
      }) as never);
    }
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

  it('the coarse SDK check still offers grant sign-in, but a delegated WebCrypto key cannot be created', async () => {
    expect(GrantAuthFlow.isDelegationAvailable).toBe(true);
    expect(HomeserverService.isGrantSignInAvailable()).toBe(true);

    await expect(
      GrantAuthFlow.startDelegated(CAPABILITIES, AuthFlowKind.signin(), {
        clientId: getShopGrantClientId(),
        relay: getDefaultHttpRelay(),
      }),
    ).rejects.toMatchObject({ name: 'ClientStateError' });
  });

  it('sign-in qr is still a signin_grant for the shop, using the SDK-held fallback key', async () => {
    const attemptsBefore = ed25519Attempts;
    const { authorizationUrl, awaitApproval, cancelAuthFlow } = await HomeserverService.generateGrantAuthUrl();
    awaitApproval.catch(() => undefined);
    try {
      const url = new URL(authorizationUrl);

      expect(url.protocol).toBe('pubkyauth:');
      expect(url.host).toBe('signin_grant');
      expect(url.searchParams.get('caps')).toBe(CAPABILITIES);
      expect(url.searchParams.get('cid')).toBe(getShopGrantClientId());
      expect(PublicKey.from(url.searchParams.get('cpk')!).toUint8Array()).toHaveLength(32);
      // No browser-held key entry exists, so nothing is marked for key cleanup.
      expect(shopMarkers()).toEqual([]);
    } finally {
      cancelAuthFlow();
    }
    expect(ed25519Attempts).toBeGreaterThan(attemptsBefore);
    await expect(awaitApproval).rejects.toBeDefined();
    expect(pendingOwnedGrants()).toEqual([]);
  });

  it('signup qr is a signup_grant on the same fallback', async () => {
    const flow = await HomeserverService.generateSignupAuthUrl({ inviteCode: 'test-invite' });
    flow.awaitApproval.catch(() => {});
    try {
      expect(new URL(flow.authorizationUrl).host).toBe('signup_grant');
    } finally {
      flow.cancelAuthFlow();
    }
  });

  it('resumes a pending fallback flow on the same relay channel after the relay drops', async () => {
    const resume = vi.spyOn(Pubky.prototype, 'resumeGrantAuthFlow');
    const resumeDelegated = vi.spyOn(GrantAuthFlow, 'resumeDelegated');
    relayOnline = false;
    const flow = await HomeserverService.generateGrantAuthUrl();
    flow.awaitApproval.catch(() => {});
    try {
      await vi.waitFor(() => expect(resume).toHaveBeenCalled(), { timeout: 5000 });
      expect(resumeDelegated).not.toHaveBeenCalled();
      const resumed = resume.mock.results[0].value as GrantAuthFlow;
      expect(resumed.authorizationUrl).toBe(flow.authorizationUrl);
    } finally {
      relayOnline = true;
      flow.cancelAuthFlow();
      resume.mockRestore();
      resumeDelegated.mockRestore();
    }
    expect(shopMarkers()).toEqual([]);
  });
});
