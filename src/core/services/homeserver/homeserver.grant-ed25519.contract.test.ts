import { webcrypto } from 'node:crypto';
import { PublicKey } from '@synonymdev/pubky';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, getShopGrantClientId } from '@/config/app';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';
import { pendingOwnedGrants } from './owned-grant-storage';

const shopKeyMarkers = () => Object.keys(localStorage).filter((name) => name.startsWith('shop-owned-grant-v1:key:'));

let relayOnline = true;
/** Relay requests still open; a freed flow's background poll must end before the next test changes the relay. */
let openRelayRequests = 0;

/**
 * A browser with WebCrypto Ed25519 keeps the grant proof-of-possession key as a
 * non-extractable WebCrypto key; the SDK-held fallback is only for browsers without it.
 * Companion of `homeserver.grant-no-ed25519.contract.test.ts` (the SDK caches its probe per module).
 */
describe('Shop grant sign-in with WebCrypto Ed25519 (real SDK)', () => {
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

  it('sign-in qr signs with a non-extractable WebCrypto Ed25519 key, removed on cancel', async () => {
    const generateKey = vi.spyOn(webcrypto.subtle, 'generateKey');
    const { authorizationUrl, awaitApproval, cancelAuthFlow } = await HomeserverService.generateGrantAuthUrl();
    awaitApproval.catch(() => undefined);
    try {
      const url = new URL(authorizationUrl);
      expect(url.host).toBe('signin_grant');
      expect(url.searchParams.get('caps')).toBe(CAPABILITIES);
      expect(url.searchParams.get('cid')).toBe(getShopGrantClientId());

      const ed25519Calls = generateKey.mock.calls
        .map(([algorithm, extractable], index) => ({ algorithm, extractable, result: generateKey.mock.results[index] }))
        .filter(({ algorithm }) => (algorithm as Algorithm).name === 'Ed25519');
      expect(ed25519Calls.length).toBeGreaterThan(0);
      for (const { extractable } of ed25519Calls) expect(extractable).toBe(false);

      const webCryptoPublicKeys = await Promise.all(
        ed25519Calls.map(async ({ result }) => {
          const { publicKey } = (await result.value) as CryptoKeyPair;
          return Array.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey)));
        }),
      );
      const qrClientKey = Array.from(PublicKey.from(url.searchParams.get('cpk')!).toUint8Array());
      expect(webCryptoPublicKeys).toContainEqual(qrClientKey);
      expect(shopKeyMarkers()).toHaveLength(1);
    } finally {
      cancelAuthFlow();
      generateKey.mockRestore();
    }
    await vi.waitFor(() => expect(shopKeyMarkers()).toEqual([]));
    expect(pendingOwnedGrants()).toEqual([]);
  });
});
