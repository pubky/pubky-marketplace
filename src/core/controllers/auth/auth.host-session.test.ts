import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { clearPrivateData } from '@/database/franky/franky.helpers';
import { writeHostIdentity } from '@/libs/auth/host-identity';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { useAuthStore } from '@/stores/auth/auth.store';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { AuthController } from './auth';
import { deferred, grantSession, resetGrantTest } from './auth.grant-test-utils';
import type { HostSessionSnapshot } from './auth.types';
import { withAuthFinalizationLock } from './auth-finalization-lock';

vi.mock('@/database/franky/franky.helpers', () => ({ clearPrivateData: vi.fn(), clearDatabase: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: vi.fn().mockReturnValue(true) }));
vi.mock('@/libs/utils/utils', async (original) => ({ ...(await original<object>()), clearCookies: vi.fn() }));
const ready = (pubky = 'alice', generation = '1'): HostSessionSnapshot => ({
  status: 'ready',
  generation,
  pubky,
  clientId: 'pubky.app',
  grantId: `grant-${pubky}`,
  sessionStoreId: `${pubky}:grant-${pubky}`,
});

beforeEach(() => {
  resetGrantTest();
  vi.mocked(clearPrivateData).mockClear();
  vi.mocked(requestShopHostAction).mockClear();
});
afterEach(() => {
  AuthController.setHostSessionMode(false);
  vi.restoreAllMocks();
});

describe('App-owned grant consumer', () => {
  it('restores exactly the host reference and never saves or retires it', async () => {
    const session = grantSession('alice', 'pubky.app', 'grant-alice');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(session);
    await expect(AuthController.applyHostSession(ready())).resolves.toBe('ready');
    expect(AuthApplication.restoreHostSession).toHaveBeenCalledWith({
      pubky: 'alice',
      clientId: 'pubky.app',
      grantId: 'grant-alice',
      sessionStoreId: 'alice:grant-alice',
    });
    expect(useAuthStore.getState()).toMatchObject({
      session,
      currentUserPubky: 'alice',
      sessionOwner: 'host',
      grantSigner: 'host',
      hostGeneration: '1',
      grantSessionRecordId: null,
    });
    const persisted = JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!);
    expect(persisted.state).toMatchObject({ currentUserPubky: null, sessionExport: null, grantSessionRecordId: null });
    expect(AuthApplication.saveGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.logout).not.toHaveBeenCalled();
  });
  it('never restores a persisted Shop pointer while waiting for App', async () => {
    useAuthStore.setState({ grantSessionRecordId: 'old-shop-record', currentUserPubky: 'old' });
    AuthController.setHostSessionMode(true);
    const restore = vi.spyOn(AuthApplication, 'restorePersistedSession');
    await expect(AuthController.restorePersistedSession()).resolves.toEqual({ status: 'deferred' });
    expect(restore).not.toHaveBeenCalled();
    await expect(AuthController.getAuthUrl()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('delegates logout to App and leaves the active grant untouched', async () => {
    const session = grantSession('alice', 'pubky.app');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(session);
    await AuthController.applyHostSession(ready());
    await AuthController.logout();
    expect(requestShopHostAction).toHaveBeenCalledWith('request-logout');
    expect(AuthApplication.logout).not.toHaveBeenCalled();
    expect(AuthApplication.clearGrantSessions).not.toHaveBeenCalled();
    await AuthController.applyHostSession({
      ...ready(),
      generation: '2',
      status: 'signed-out',
      pubky: null,
      sessionStoreId: null,
      grantId: null,
      clientId: null,
    });
    expect(useAuthStore.getState().session).toBeNull();
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
  });
  it('ignores a pending old generation restore before installing the next account', async () => {
    const old = deferred<Session>();
    const alice = grantSession('alice', 'pubky.app');
    const bob = grantSession('bob', 'pubky.app');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockReturnValueOnce(old.promise).mockResolvedValueOnce(bob);
    const first = AuthController.applyHostSession(ready());
    await vi.waitFor(() => expect(AuthApplication.restoreHostSession).toHaveBeenCalledOnce());
    const second = AuthController.applyHostSession(ready('bob', '2'));
    expect(useAuthStore.getState().session).toBeNull();
    expect(await first).toBe('restoring');
    expect(await second).toBe('ready');
    old.resolve(alice);
    expect(useAuthStore.getState()).toMatchObject({ session: bob, currentUserPubky: 'bob' });
    expect(AuthApplication.logout).not.toHaveBeenCalled();
  });
  it('a hung old profile lookup cannot block host sign-out', async () => {
    const profile = deferred<boolean>();
    vi.mocked(AuthApplication.userIsSignedUp).mockReturnValueOnce(profile.promise);
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
    const first = AuthController.applyHostSession(ready());
    await vi.waitFor(() => expect(AuthApplication.userIsSignedUp).toHaveBeenCalled());
    expect(
      await AuthController.applyHostSession({ ...ready(), status: 'signed-out', generation: '2', pubky: null }),
    ).toBe('signed-out');
    expect(await first).toBe('restoring');
    profile.resolve(true);
    expect(useAuthStore.getState().currentUserPubky).toBeNull();
    expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
  });
  it('invalidates the live session immediately during an account switch and waits for old bootstrap before cleaning', async () => {
    vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
    const bootstrap = deferred<Awaited<ReturnType<typeof BootstrapApplication.initialize>>>();
    vi.mocked(BootstrapApplication.initialize).mockReturnValueOnce(bootstrap.promise);
    vi.spyOn(AuthApplication, 'restoreHostSession')
      .mockResolvedValueOnce(grantSession('alice', 'pubky.app'))
      .mockResolvedValueOnce(grantSession('bob', 'pubky.app'));
    const first = AuthController.applyHostSession(ready());
    await vi.waitFor(() => expect(BootstrapApplication.initialize).toHaveBeenCalledOnce());
    expect(useAuthStore.getState().currentUserPubky).toBe('alice');
    const second = AuthController.applyHostSession(ready('bob', '2'));
    expect(useAuthStore.getState().session).toBeNull();
    bootstrap.resolve({} as Awaited<ReturnType<typeof BootstrapApplication.initialize>>);
    await first;
    await second;
    expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: 'bob', hasProfile: true });
    expect(clearPrivateData).toHaveBeenCalledTimes(2);
  });
  it.each(['restoring', 'temporary-error', 'reauth-required', 'signed-out'] as const)(
    'handles host %s without touching SDK credentials',
    async (status) => {
      vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
      await AuthController.applyHostSession(ready());
      await expect(AuthController.applyHostSession({ ...ready(), generation: '2', status })).resolves.toBe(status);
      expect(useAuthStore.getState().session).toBeNull();
      expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
      expect(AuthApplication.logout).not.toHaveBeenCalled();
    },
  );
  it('allows retry of the same public snapshot after a temporary restore failure', async () => {
    vi.spyOn(AuthApplication, 'restoreHostSession')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(grantSession('alice', 'pubky.app'));
    expect(await AuthController.applyHostSession(ready())).toBe('temporary-error');
    expect(await AuthController.applyHostSession(ready())).toBe('ready');
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
  });
  it.each([
    ['missing-capabilities', 'capabilities-required'],
    ['invalid-reference', 'reauth-required'],
  ] as const)('distinguishes %s from transient restore failure', async (reason, status) => {
    vi.spyOn(AuthApplication, 'restoreHostSession').mockRejectedValue(
      Err.auth(AuthErrorCode.UNAUTHORIZED, 'Host grant requires attention', {
        service: ErrorService.Homeserver,
        operation: 'restoreHostSession',
        context: { reason },
      }),
    );
    expect(await AuthController.applyHostSession(ready())).toBe(status);
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
  });
  it('same-account generation changes retain wrapped messaging history', async () => {
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
    await AuthController.applyHostSession(ready());
    await AuthController.applyHostSession(ready('alice', '2'));
    expect(clearPrivateData).toHaveBeenCalledTimes(1);
  });
  it('restores same-account marketplace/inventory approvals across an iframe reload', async () => {
    writeHostIdentity('alice');
    const clear = vi.spyOn(CommerceController, 'clearMarketplaceSessionForSignOut');
    const marketplace = {
      pubky: 'alice',
      expiresAt: '2099-01-01T00:00:00Z',
      capabilities: '/marketplace/:r',
      issuedAt: '2026-01-01T00:00:00Z',
    };
    vi.spyOn(CommerceApplication, 'restoreMarketplaceSession').mockReturnValue(marketplace);
    const inventory = vi.spyOn(CommerceApplication, 'restoreInventorySession').mockReturnValue(null);
    const write = vi.spyOn(CommerceController, 'writeMarketplaceSessionStore').mockImplementation(() => {});
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
    await AuthController.applyHostSession(ready());
    expect(clear).not.toHaveBeenCalled();
    expect(clearPrivateData).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(marketplace);
    expect(inventory).toHaveBeenCalledWith('alice');
    await AuthController.applyHostSession({ ...ready(), status: 'temporary-error' });
    expect(clear).not.toHaveBeenCalled();
    expect(clearPrivateData).not.toHaveBeenCalled();
  });
  it('clears prior service approvals on an account switch and host sign-out', async () => {
    writeHostIdentity('alice');
    const clear = vi.spyOn(CommerceController, 'clearMarketplaceSessionForSignOut');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('bob', 'pubky.app'));
    await AuthController.applyHostSession(ready('bob', '2'));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clearPrivateData).toHaveBeenCalledTimes(1);
    await AuthController.applyHostSession({ ...ready('bob', '3'), status: 'signed-out', pubky: null });
    expect(clear).toHaveBeenCalledTimes(2);
    expect(clearPrivateData).toHaveBeenCalledTimes(2);
  });
  it('rechecks the shared owner after waiting for another frame to prepare the same account', async () => {
    useAuthStore.getState().init({ session: grantSession('alice'), currentUserPubky: 'alice', hasProfile: true });
    writeHostIdentity('alice');
    const held = deferred<void>();
    const entered = deferred<void>();
    const otherFrame = withAuthFinalizationLock(async () => {
      entered.resolve();
      await held.promise;
    });
    await entered.promise;
    const clearAllServices = vi.spyOn(CommerceController, 'clearMarketplaceSessionForSignOut');
    const clearOtherServices = vi.spyOn(CommerceController, 'clearMarketplaceSessionsOfOtherAccounts');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('bob', 'pubky.app'));
    const restore = AuthController.applyHostSession(ready('bob', '2'));
    // The other frame owns the lock, has cleared Alice, and now owns Bob's private DB.
    writeHostIdentity('bob');
    held.resolve();
    await otherFrame;
    expect(await restore).toBe('ready');
    expect(clearPrivateData).not.toHaveBeenCalled();
    expect(clearAllServices).not.toHaveBeenCalled();
    expect(clearOtherServices).toHaveBeenCalledWith('bob');
    expect(useAuthStore.getState().currentUserPubky).toBe('bob');
  });
  it('keeps mutating host bootstrap under the same cross-frame cleanup lock', async () => {
    vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
    const bootstrap = deferred<Awaited<ReturnType<typeof BootstrapApplication.initialize>>>();
    vi.mocked(BootstrapApplication.initialize).mockReturnValueOnce(bootstrap.promise);
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
    const restore = AuthController.applyHostSession(ready());
    await vi.waitFor(() => expect(BootstrapApplication.initialize).toHaveBeenCalled());
    const cleanup = vi.fn();
    const otherFrame = withAuthFinalizationLock(async () => {
      cleanup();
    });
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    bootstrap.resolve({} as Awaited<ReturnType<typeof BootstrapApplication.initialize>>);
    await restore;
    await otherFrame;
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('defers a blocked cleanup without touching the App credential and permits retry', async () => {
    writeHostIdentity('alice');
    vi.mocked(clearPrivateData).mockRejectedValueOnce(new DOMException('blocked', 'UnknownError'));
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('bob', 'pubky.app'));
    expect(await AuthController.applyHostSession(ready('bob', '2'))).toBe('temporary-error');
    expect(useAuthStore.getState().session).toBeNull();
    expect(AuthApplication.restoreHostSession).not.toHaveBeenCalled();
    expect(await AuthController.applyHostSession(ready('bob', '2'))).toBe('ready');
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.logout).not.toHaveBeenCalled();
  });
});
