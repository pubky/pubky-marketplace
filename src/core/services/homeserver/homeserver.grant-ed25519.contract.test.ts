// @vitest-environment node
import { PublicKey } from '@synonymdev/pubky';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, getShopGrantClientId } from '@/config/app';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';

/**
 * A browser with WebCrypto Ed25519 keeps the grant proof-of-possession key as a
 * non-extractable WebCrypto key; the SDK-held fallback is only for browsers without it.
 * Companion of `homeserver.grant-no-ed25519.contract.test.ts` (the SDK caches its probe per module).
 */
describe('Bitkit grant sign-in with WebCrypto Ed25519 (real SDK)', () => {
  beforeAll(() => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal(
      'fetch',
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    installWebLocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    removeWebLocks();
  });

  it('bitkit qr signs with a non-extractable WebCrypto Ed25519 key', async () => {
    const generateKey = vi.spyOn(globalThis.crypto.subtle, 'generateKey');
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
          return Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)));
        }),
      );
      const qrClientKey = Array.from(PublicKey.from(url.searchParams.get('cpk')!).toUint8Array());
      expect(webCryptoPublicKeys).toContainEqual(qrClientKey);
    } finally {
      cancelAuthFlow();
    }
  });
});
