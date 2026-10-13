import { webcrypto } from 'node:crypto';
import { AuthFlowKind, GrantAuthFlow, Keypair, Pubky } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, SHOP_GRANT_CLIENT_ID } from '@/config/app';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { HomeserverService } from './homeserver';
import {
  delegatedKeyId,
  forgetOwnedGrant,
  pendingOwnedGrants,
  rememberOwnedGrant,
  removeOwnedDelegatedKey,
} from './owned-grant-storage';

vi.mock('@/config/network', async (original) => ({
  ...(await original<object>()),
  getHomeserver: () => Keypair.random().publicKey.z32(),
}));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('isSecureContext', true);
  installWebLocks();
  localStorage.clear();
  // The SDK starts relay polling in the background before awaitApproval.
  // Keep it in flight until flow.free() aborts it. The global unit-test fetch
  // returns a Response with url='', which makes reqwest's WASM URL parser
  // panic if a busy full-suite worker lets that background poll complete.
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
  // Let SDK abort continuations finish before restoring the surrounding globals.
  await new Promise((resolve) => setTimeout(resolve, 0));
  removeWebLocks();
  vi.unstubAllGlobals();
});

describe('SDK 0.16 bare-grant and owned-key compatibility contract', () => {
  it('Ring requests a bare grant with Shop permissions and no encryption scope', async () => {
    const flow = await HomeserverService.generateAuthUrl();
    flow.awaitApproval.catch(() => {});
    const url = new URL(flow.authorizationUrl);
    expect(url.host).toBe('signin_grant');
    expect(url.searchParams.get('caps')).toBe(CAPABILITIES);
    expect(url.searchParams.get('cid')).toBe(SHOP_GRANT_CLIENT_ID);
    expect(url.searchParams.has('af')).toBe(false);
    expect(url.searchParams.has('epk')).toBe(false);
    flow.cancelAuthFlow();
    await vi.waitFor(() => expect(pendingOwnedGrants()).toEqual([]));
  });
  it('signup uses SDK signup_grant instead of rewriting a cookie URL', async () => {
    const flow = await HomeserverService.generateSignupAuthUrl({ inviteCode: 'test-invite' });
    flow.awaitApproval.catch(() => {});
    const url = new URL(flow.authorizationUrl);
    expect(url.host).toBe('signup_grant');
    expect(url.searchParams.get('caps')).toBe(CAPABILITIES);
    expect(url.searchParams.get('st')).toBe('test-invite');
    expect(url.searchParams.get('cid')).toBe(SHOP_GRANT_CLIENT_ID);
    expect(url.searchParams.has('af')).toBe(false);
    flow.cancelAuthFlow();
    await vi.waitFor(() => expect(pendingOwnedGrants()).toEqual([]));
  });
  it('deletes only the owned pending key while a different app can still resume its flow', async () => {
    const ours = await GrantAuthFlow.startDelegated(CAPABILITIES, AuthFlowKind.signin(), {
      clientId: SHOP_GRANT_CLIENT_ID,
      approvalFormat: 'bareGrant',
    });
    const theirs = await GrantAuthFlow.startDelegated('/:rw', AuthFlowKind.signin(), {
      clientId: 'pubky.app',
      approvalFormat: 'bareGrant',
    });
    const oursSaved = ours.saveDelegated(),
      theirsSaved = theirs.saveDelegated();
    const id = delegatedKeyId(oursSaved);
    rememberOwnedGrant('key', id);
    // Exercise cancellation with a genuinely pending SDK background poll.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    ours.free();
    theirs.free();
    await removeOwnedDelegatedKey(id);
    forgetOwnedGrant('key', id);
    await expect(GrantAuthFlow.resumeDelegated(oursSaved)).rejects.toMatchObject({ name: 'ClientStateError' });
    const resumed = await GrantAuthFlow.resumeDelegated(theirsSaved);
    resumed.free();
    await removeOwnedDelegatedKey(delegatedKeyId(theirsSaved));
  });
  it('preserves a cleanup marker after blocked IndexedDB removal', async () => {
    rememberOwnedGrant('key', 'only-owned-id');
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('blocked', 'UnknownError');
      },
    });
    await expect(removeOwnedDelegatedKey('only-owned-id')).rejects.toThrow();
    expect(pendingOwnedGrants()).toMatchObject([{ kind: 'key', id: 'only-owned-id' }]);
  });
  it('rejects disabled durable ownership storage before exposing a signer URL', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    try {
      await expect(HomeserverService.generateAuthUrl()).rejects.toMatchObject({ code: 'INIT_FAILED' });
    } finally {
      set.mockRestore();
    }
  });
  it('pins targeted cleanup to the SDK schema and public flow handle', async () => {
    const sdk = new Pubky();
    expect(await sdk.browserSessionStore.isAvailable()).toBe(true);
    expect(() => delegatedKeyId('{"unexpected":"future schema"}')).toThrow();
    expect(() => delegatedKeyId('{broken')).toThrow();
  });
});
