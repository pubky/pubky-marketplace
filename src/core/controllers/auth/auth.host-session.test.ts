import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { clearPrivateData } from '@/database/franky/franky.helpers';
import { writeHostIdentity } from '@/libs/auth/host-identity';
import { HOSTED_SIGN_IN_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { captureAppError } from '@/libs/observability/sentry';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { writeAppliedHostCleanupEpoch } from '@/libs/shop-session/cleanup';
import { useAuthStore } from '@/stores/auth/auth.store';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { AuthController } from './auth';
import { deferred, grantSession, resetGrantTest } from './auth.grant-test-utils';
import type { HostSessionSnapshot } from './auth.types';
import { withAuthFinalizationLock } from './auth-finalization-lock';

// The global database setup imports the factory before this file's mocks.
vi.hoisted(() => vi.resetModules());
vi.mock('@/libs/observability/sentry', () => ({ captureAppError: vi.fn() }));
vi.mock('@/database/franky/franky.helpers', () => ({ clearPrivateData: vi.fn(), clearDatabase: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: vi.fn().mockReturnValue(true) }));
vi.mock('@/libs/utils/utils', async (original) => ({ ...(await original<object>()), clearCookies: vi.fn() }));
vi.mock('@/services/marketplace/marketplace-grant-client', async (original) => ({
  ...(await original<object>()),
  clearMarketplaceBffSessionConfirmed: vi.fn().mockResolvedValue(undefined),
}));
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
  it.each([
    ['Ring', () => AuthController.getAuthUrl()],
    ['Bitkit', () => AuthController.getGrantAuthUrl()],
    ['Passport', () => AuthController.getPassportGrantAuthUrl()],
  ])('sends a %s sign-in started in the embedded Shop to App without reporting it', async (_signer, start) => {
    vi.mocked(captureAppError).mockClear();
    AuthController.setHostSessionMode(true);
    await expect(start()).rejects.toMatchObject({
      category: ErrorCategory.Auth,
      code: AuthErrorCode.UNAUTHORIZED,
      message: HOSTED_SIGN_IN_MESSAGE,
      operation: 'standaloneSignIn',
    });
    expect(captureAppError).not.toHaveBeenCalled();
  });
  it('delegates logout to App and leaves the active grant untouched', async () => {
    const session = grantSession('alice', 'pubky.app');
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(session);
    await AuthController.applyHostSession(ready());
    vi.mocked(AuthApplication.clearGrantSessions).mockClear();
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
  it('invalidates the live session immediately during an account switch without social bootstrap', async () => {
    vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
    vi.spyOn(AuthApplication, 'restoreHostSession')
      .mockResolvedValueOnce(grantSession('alice', 'pubky.app'))
      .mockResolvedValueOnce(grantSession('bob', 'pubky.app'));
    await expect(AuthController.applyHostSession(ready())).resolves.toBe('ready');
    expect(useAuthStore.getState().currentUserPubky).toBe('alice');
    const second = AuthController.applyHostSession(ready('bob', '2'));
    expect(useAuthStore.getState().session).toBeNull();
    await expect(second).resolves.toBe('ready');
    expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: 'bob', hasProfile: true });
    expect(clearPrivateData).toHaveBeenCalledTimes(2);
    expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
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
    writeAppliedHostCleanupEpoch('');
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
    writeAppliedHostCleanupEpoch('');
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
    writeAppliedHostCleanupEpoch('');
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
    writeAppliedHostCleanupEpoch('');
    held.resolve();
    await otherFrame;
    expect(await restore).toBe('ready');
    expect(clearPrivateData).not.toHaveBeenCalled();
    expect(clearAllServices).not.toHaveBeenCalled();
    expect(clearOtherServices).toHaveBeenCalledWith('bob');
    expect(useAuthStore.getState().currentUserPubky).toBe('bob');
  });
  it('holds account cleanup under the same cross-frame cleanup lock', async () => {
    const clearing = deferred<void>();
    vi.mocked(clearPrivateData).mockReturnValueOnce(clearing.promise);
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
    const restore = AuthController.applyHostSession(ready());
    await vi.waitFor(() => expect(clearPrivateData).toHaveBeenCalled());
    const cleanup = vi.fn();
    const otherFrame = withAuthFinalizationLock(async () => {
      cleanup();
    });
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    clearing.resolve();
    await restore;
    await otherFrame;
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('defers a blocked cleanup without touching the App credential and permits retry', async () => {
    writeHostIdentity('alice');
    writeAppliedHostCleanupEpoch('');
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

it('retires a standalone owned record before host adoption discards its pointer', async () => {
  useAuthStore.getState().init({
    session: grantSession(),
    currentUserPubky: 'alice',
    hasProfile: true,
    grantSessionRecordId: 'alice:owned',
  });
  const queue = vi.spyOn(AuthApplication, 'queueGrantRetirement');
  vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  await AuthController.applyHostSession(ready());
  expect(queue).toHaveBeenCalledWith('alice:owned');
  expect(AuthApplication.clearGrantSessions).toHaveBeenCalledWith(
    expect.objectContaining({ protectedRecordIds: ['alice:grant-alice'] }),
  );
  expect(useAuthStore.getState().grantSessionRecordId).toBeNull();
});

it('does not block host logout behind a stalled retirement of an older standalone grant', async () => {
  const retirement = deferred<void>();
  vi.spyOn(AuthApplication, 'clearGrantSessions').mockReturnValueOnce(retirement.promise);
  vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  let status: string | undefined;
  const applying = AuthController.applyHostSession(ready()).then((value) => {
    status = value;
  });
  try {
    await vi.waitFor(() => expect(status).toBe('ready'), { timeout: 300 });
    expect(
      await AuthController.applyHostSession({
        ...ready('alice', '2'),
        pubky: null,
        status: 'signed-out',
        sessionStoreId: null,
        grantId: null,
        clientId: null,
      }),
    ).toBe('signed-out');
    expect(useAuthStore.getState().session).toBeNull();
  } finally {
    retirement.resolve();
    await applying;
  }
});

it('clears stale service approvals before a same-account return across an App logout boundary', async () => {
  const clear = vi.spyOn(CommerceController, 'clearMarketplaceSessionForSignOut');
  vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '1', currentUserPubky: 'alice', shopCleanupEpoch: 'before-logout' } }),
  );
  await AuthController.applyHostSession({ ...ready(), shopCleanupEpoch: 'before-logout' });
  clear.mockClear();
  vi.mocked(clearPrivateData).mockClear();
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '2', currentUserPubky: 'alice', shopCleanupEpoch: 'after-logout' } }),
  );
  await AuthController.applyHostSession({ ...ready('alice', '2'), shopCleanupEpoch: 'after-logout' });
  expect(clear).toHaveBeenCalledOnce();
  expect(clearPrivateData).toHaveBeenCalledOnce();
  clear.mockClear();
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '3', currentUserPubky: 'alice', shopCleanupEpoch: 'after-logout' } }),
  );
  await AuthController.applyHostSession({ ...ready('alice', '3'), shopCleanupEpoch: 'after-logout' });
  expect(clear).not.toHaveBeenCalled();
});

it('does not install a stale same-account host snapshot after its durable boundary changed', async () => {
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '2', currentUserPubky: 'alice', shopCleanupEpoch: 'new' } }),
  );
  const restore = vi.spyOn(AuthApplication, 'restoreHostSession');
  expect(await AuthController.applyHostSession({ ...ready(), shopCleanupEpoch: 'old' })).toBe('restoring');
  expect(restore).not.toHaveBeenCalled();
  expect(useAuthStore.getState().session).toBeNull();
});

it.each([
  { generation: '1', currentUserPubky: 'alice', shopCleanupEpoch: 'new' },
  { generation: '2', currentUserPubky: 'alice' },
  { generation: '1', currentUserPubky: null },
])('rejects a legacy host snapshot superseded by durable App state %j', async (state) => {
  localStorage.setItem('auth-store-v3', JSON.stringify({ state }));
  const restore = vi.spyOn(AuthApplication, 'restoreHostSession');
  expect(await AuthController.applyHostSession(ready())).toBe('restoring');
  expect(restore).not.toHaveBeenCalled();
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBeNull();
  expect(useAuthStore.getState().session).toBeNull();
});

it('cleans once before accepting a matching legacy App snapshot without an epoch', async () => {
  localStorage.setItem('auth-store-v3', JSON.stringify({ state: { generation: '1', currentUserPubky: 'alice' } }));
  vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  expect(await AuthController.applyHostSession(ready())).toBe('ready');
  expect(clearPrivateData).toHaveBeenCalledOnce();
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBe('');
});

it('allows a fresh App guest with no durable auth metadata to clean up and browse publicly', async () => {
  expect(localStorage.getItem('auth-store-v3')).toBeNull();
  const restore = vi.spyOn(AuthApplication, 'restoreHostSession');
  expect(
    await AuthController.applyHostSession({
      status: 'signed-out',
      pubky: null,
      generation: '',
      shopCleanupEpoch: '',
      sessionStoreId: null,
      grantId: null,
      clientId: null,
    }),
  ).toBe('signed-out');
  expect(clearPrivateData).toHaveBeenCalledOnce();
  expect(restore).not.toHaveBeenCalled();
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBe('');
});

it('keeps the cleanup boundary unacknowledged after private storage cleanup fails', async () => {
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '1', currentUserPubky: 'alice', shopCleanupEpoch: 'new' } }),
  );
  vi.mocked(clearPrivateData).mockRejectedValueOnce(new DOMException('blocked', 'UnknownError'));
  const restore = vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  const snapshot = { ...ready(), shopCleanupEpoch: 'new' };
  expect(await AuthController.applyHostSession(snapshot)).toBe('temporary-error');
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBeNull();
  expect(restore).not.toHaveBeenCalled();
  expect(await AuthController.applyHostSession(snapshot)).toBe('ready');
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBe('new');
});

it('waits for confirmed BFF cleanup before acknowledging a host boundary or restoring its grant', async () => {
  localStorage.setItem(
    'auth-store-v3',
    JSON.stringify({ state: { generation: '1', currentUserPubky: 'alice', shopCleanupEpoch: 'new' } }),
  );
  const confirmation = deferred<void>();
  const clear = vi
    .spyOn(CommerceController, 'clearMarketplaceSessionForSignOut')
    .mockImplementationOnce(() => confirmation.promise);
  const restore = vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(grantSession('alice', 'pubky.app'));
  const snapshot = { ...ready(), shopCleanupEpoch: 'new' };
  const applying = AuthController.applyHostSession(snapshot);
  await vi.waitFor(() => expect(clearPrivateData).toHaveBeenCalledOnce());
  expect(clear).toHaveBeenCalledWith({ confirmBff: true });
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBeNull();
  expect(restore).not.toHaveBeenCalled();
  confirmation.reject(new Error('offline'));
  expect(await applying).toBe('temporary-error');
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBeNull();
  clear.mockImplementation(() => undefined);
  expect(await AuthController.applyHostSession(snapshot)).toBe('ready');
  expect(restore).toHaveBeenCalledOnce();
  expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBe('new');
});

it('drains a pending BFF deletion before a failed private cleanup releases the host transition', async () => {
  const confirmation = deferred<void>();
  const clear = vi
    .spyOn(CommerceController, 'clearMarketplaceSessionForSignOut')
    .mockImplementationOnce(() => confirmation.promise)
    .mockImplementation(() => undefined);
  vi.mocked(clearPrivateData).mockRejectedValueOnce(new DOMException('blocked', 'UnknownError'));
  let settled = false;
  const applying = AuthController.applyHostSession(ready()).then((status) => {
    settled = true;
    return status;
  });
  await vi.waitFor(() => expect(clearPrivateData).toHaveBeenCalledOnce());
  // A second snapshot must wait behind the old DELETE even after local cleanup fails.
  const signedOut = AuthController.applyHostSession({
    ...ready('alice', '2'),
    status: 'signed-out',
    pubky: null,
    clientId: null,
    grantId: null,
    sessionStoreId: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    expect(settled).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    expect(localStorage.getItem('shop-host-cleanup-epoch-v1')).toBeNull();
  } finally {
    confirmation.resolve();
    await applying;
    await signedOut;
  }
  expect(await signedOut).toBe('signed-out');
  expect(clear).toHaveBeenCalledTimes(2);
});

it('keeps a valid hosted grant usable without depending on the social Nexus bootstrap', async () => {
  const session = grantSession('alice', 'pubky.app', 'grant-alice');
  vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(session);
  vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
  vi.mocked(BootstrapApplication.initialize).mockRejectedValue(new Error('Nexus unavailable'));
  await expect(AuthController.applyHostSession(ready())).resolves.toBe('ready');
  expect(useAuthStore.getState()).toMatchObject({ session, hasProfile: true });
  expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
});
