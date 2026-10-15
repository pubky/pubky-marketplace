import { webcrypto } from 'node:crypto';
import { Keypair } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, KEYED_CAPABILITIES, SHOP_GRANT_CLIENT_ID } from '@/config/app';
import { getHomeserver } from '@/config/network';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import type { TGenerateAuthUrlResult, TGrantAuthUrlOptions } from '@/services/homeserver/homeserver.types';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';
import { pendingOwnedGrants } from './owned-grant-storage';

const deploy = vi.hoisted(() => ({ homeserver: '' }));

vi.mock('@/config/network', async (original) => ({
  ...(await original<object>()),
  getHomeserver: () => (deploy.homeserver ||= Keypair.random().publicKey.z32()),
}));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('isSecureContext', true);
  installWebLocks();
  localStorage.clear();
  // Keep the SDK's background relay poll pending until flow.free() aborts it
  // (see homeserver.ring-url.contract.test.ts).
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('The fixture relay was canceled', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }),
  );
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  removeWebLocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTests();
});

function configure(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  resetRuntimeConfigForTests();
}

const listed = () => JSON.stringify([getHomeserver()]);

async function grantUrl(options?: TGrantAuthUrlOptions): Promise<URL> {
  const flow: TGenerateAuthUrlResult =
    options === undefined
      ? await HomeserverService.generateGrantAuthUrl()
      : await HomeserverService.generateGrantAuthUrl(undefined, options);
  flow.awaitApproval.catch(() => {});
  try {
    return new URL(flow.authorizationUrl);
  } finally {
    flow.cancelAuthFlow();
    await vi.waitFor(() => expect(pendingOwnedGrants()).toEqual([]));
  }
}

const expectKeyed = (url: URL) => {
  expect(url.host).toBe('signin_grant');
  expect(url.searchParams.get('caps')).toBe(KEYED_CAPABILITIES);
  expect(url.searchParams.get('cid')).toBe(SHOP_GRANT_CLIENT_ID);
  expect(url.searchParams.get('af')).toBe('v1');
};

const expectBare = (url: URL) => {
  expect(url.host).toBe('signin_grant');
  expect(url.searchParams.get('caps')).toBe(CAPABILITIES);
  expect(url.searchParams.get('cid')).toBe(SHOP_GRANT_CLIENT_ID);
  expect(url.searchParams.has('af')).toBe(false);
};

describe('SDK 0.16 scoped encryption keys in the grant sign-in link', () => {
  it('requests a bare grant by default, for every signer', async () => {
    expectBare(await grantUrl());
    expectBare(await grantUrl({ signer: 'passport' }));
  });

  it('asks every signer for e with a signed approval when the deploy enabled it', async () => {
    configure({ PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS: 'true', PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS: listed() });
    expectKeyed(await grantUrl());
    expectKeyed(await grantUrl({ signer: 'passport' }));
  });

  it('makes the sign-in without keys when asked, even while the deploy requests keys', async () => {
    configure({ PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS: 'true', PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS: listed() });
    expectBare(await grantUrl({ withPrivKeys: false }));
    expectBare(await grantUrl({ withPrivKeys: false, signer: 'passport' }));
  });

  it('opens e for the Passport sign-in alone with the Passport switch', async () => {
    configure({
      PUBKY_RUNTIME_PASSPORT_PRIV_ENCRYPTION_KEYS: 'true',
      PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS: listed(),
    });
    expectKeyed(await grantUrl({ signer: 'passport' }));
    expectBare(await grantUrl());
  });

  it('never asks for e while the deploy homeserver is not listed', async () => {
    configure({
      PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS: 'true',
      PUBKY_RUNTIME_PASSPORT_PRIV_ENCRYPTION_KEYS: 'true',
      PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS: JSON.stringify([Keypair.random().publicKey.z32()]),
    });
    expectBare(await grantUrl());
    expectBare(await grantUrl({ signer: 'passport' }));
  });

  it('keeps the runtime client id on a keyed request', async () => {
    configure({
      PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS: 'true',
      PUBKY_RUNTIME_PRIV_ENCRYPTION_KEYS_HOMESERVERS: listed(),
      PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID: 'staging.pubky.app',
    });
    const url = await grantUrl();
    expect(url.searchParams.get('caps')).toBe(KEYED_CAPABILITIES);
    expect(url.searchParams.get('cid')).toBe('staging.pubky.app');
    expect(url.searchParams.get('af')).toBe('v1');
  });
});
