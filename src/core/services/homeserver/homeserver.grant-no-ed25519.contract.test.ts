// @vitest-environment node
import { AuthFlowKind, GrantAuthFlow, PublicKey } from '@synonymdev/pubky';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, getShopGrantClientId } from '@/config/app';
import { getDefaultHttpRelay } from '@/config/network';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';

const isEd25519 = (algorithm: unknown): boolean => {
  const name = typeof algorithm === 'string' ? algorithm : (algorithm as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.toLowerCase() === 'ed25519';
};

const unsupported = () => Promise.reject(new DOMException('Unrecognized name.', 'NotSupportedError'));

/**
 * A browser whose WebCrypto has no Ed25519 (Chrome before 137, e.g. Chrome 124): secure context,
 * IndexedDB and Web Locks are all there, but every Ed25519 generate, import or sign rejects.
 * The SDK caches its Ed25519 probe per module instance, so this file only covers that browser.
 */
describe('Bitkit grant sign-in without WebCrypto Ed25519 (real SDK)', () => {
  const subtle = globalThis.crypto.subtle;
  let ed25519Attempts = 0;

  beforeAll(() => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    // Grant flows long-poll the relay from creation; a relay with no approval yet never answers.
    vi.stubGlobal(
      'fetch',
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    installWebLocks();
    const generateKey = subtle.generateKey.bind(subtle);
    const importKey = subtle.importKey.bind(subtle);
    const sign = subtle.sign.bind(subtle);
    vi.spyOn(subtle, 'generateKey').mockImplementation(((algorithm: unknown, ...rest: unknown[]) => {
      if (!isEd25519(algorithm)) return (generateKey as (...args: unknown[]) => unknown)(algorithm, ...rest);
      ed25519Attempts += 1;
      return unsupported();
    }) as typeof subtle.generateKey);
    vi.spyOn(subtle, 'importKey').mockImplementation(((
      format: unknown,
      data: unknown,
      algorithm: unknown,
      ...rest: unknown[]
    ) => {
      if (!isEd25519(algorithm))
        return (importKey as (...args: unknown[]) => unknown)(format, data, algorithm, ...rest);
      ed25519Attempts += 1;
      return unsupported();
    }) as typeof subtle.importKey);
    vi.spyOn(subtle, 'sign').mockImplementation(((algorithm: unknown, ...rest: unknown[]) => {
      if (!isEd25519(algorithm)) return (sign as (...args: unknown[]) => unknown)(algorithm, ...rest);
      ed25519Attempts += 1;
      return unsupported();
    }) as typeof subtle.sign);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    removeWebLocks();
  });

  it('the coarse SDK check still offers Bitkit, but a delegated WebCrypto key cannot be created', async () => {
    expect(GrantAuthFlow.isDelegationAvailable).toBe(true);
    expect(HomeserverService.isGrantSignInAvailable()).toBe(true);

    await expect(
      GrantAuthFlow.startDelegated(CAPABILITIES, AuthFlowKind.signin(), {
        clientId: getShopGrantClientId(),
        relay: getDefaultHttpRelay(),
      }),
    ).rejects.toMatchObject({ name: 'ClientStateError' });
  });

  it('bitkit qr is still a signin_grant for the shop, using the SDK-held fallback key', async () => {
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
      expect(url.searchParams.get('relay')).toBeTruthy();
    } finally {
      cancelAuthFlow();
    }
    expect(ed25519Attempts).toBeGreaterThan(attemptsBefore);
  });

  it('each Bitkit qr gets its own fallback key', async () => {
    const first = await HomeserverService.generateGrantAuthUrl();
    const second = await HomeserverService.generateGrantAuthUrl();
    first.awaitApproval.catch(() => undefined);
    second.awaitApproval.catch(() => undefined);
    try {
      const cpk = (authorizationUrl: string) => new URL(authorizationUrl).searchParams.get('cpk');
      expect(cpk(first.authorizationUrl)).not.toBe(cpk(second.authorizationUrl));
    } finally {
      first.cancelAuthFlow();
      second.cancelAuthFlow();
    }
  });
});
