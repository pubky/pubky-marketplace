import type { Pubky, Session } from '@synonymdev/pubky';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { SettingsApplication } from '@/application/settings/settings';
import { AuthController } from '@/controllers/auth/auth';
import { approve, deferred, grantSession, resetGrantTest } from '@/controllers/auth/auth.grant-test-utils';
import { bumpAuthEpoch } from '@/controllers/auth/auth-epoch';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { clearDatabase } from '@/database/franky/franky.helpers';
import { useAuthStatus } from '@/hooks/useAuthStatus/useAuthStatus';
import { AuthStatus } from '@/hooks/useAuthStatus/useAuthStatus.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { pendingOwnedGrants } from '@/services/homeserver/owned-grant-storage';
import { clearPersistedAuthIdentity } from '@/stores/auth/auth.persisted';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { useSearchStore } from '@/stores/search/search.store';
import { useSettingsStore } from '@/stores/settings/settings.store';
import { settingsInitialState } from '@/stores/settings/settings.types';
import { asOpaque } from '@/test-utils/type-assertions';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));

let records: Map<string, Session>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetGrantTest();
  useOnboardingStore.setState({ hasHydrated: true });
  // Real application/service cleanup and persistence bookkeeping, with an SDK record-store boundary double.
  for (const method of [
    'saveGrantSession',
    'commitGrantSession',
    'clearGrantSessions',
    'removeGrantSession',
    'logout',
  ] as const) {
    vi.mocked(AuthApplication[method]).mockRestore();
  }
  records = new Map();
  remove = vi.fn(async (id: string) => {
    records.delete(id);
  });
  const browserSessionStore = {
    save: vi.fn(async (session: Session) => {
      const info = await session.grant!.sessionInfo();
      const id = `${info.publicKey.z32()}:${info.grantId}`;
      records.set(id, session);
      return { id };
    }),
    restore: vi.fn(async (id: string) => {
      const session = records.get(id);
      if (!session)
        throw Object.assign(new Error(`Stored Pubky session not found: ${id}`), { name: 'ClientStateError' });
      return session;
    }),
    remove,
    list: vi.fn(async () => [...records.keys()].map((id) => ({ id }))),
    isAvailable: vi.fn(async () => true),
  };
  vi.spyOn(asOpaque<{ getPubkySdk: () => Pubky }>(HomeserverService), 'getPubkySdk').mockReturnValue(
    asOpaque<Pubky>({ browserSessionStore }),
  );
  vi.spyOn(HomeserverService, 'assertUserHomeserverAllowed').mockResolvedValue(undefined);
});
afterEach(() => {
  AuthController.cancelAllAuthFlows();
  vi.restoreAllMocks();
});

it.each(['profile', 'bootstrap'] as const)(
  'resumes profile discovery and bootstrap after interrupted %s initialization',
  async (failureAt) => {
    const session = grantSession();
    await approve(session);
    if (failureAt === 'profile') vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValueOnce(new Error('offline'));
    else {
      vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
      vi.mocked(BootstrapApplication.initialize).mockRejectedValueOnce(new Error('offline'));
    }
    await expect(AuthController.initializeAuthenticatedSession({ session })).rejects.toThrow('offline');
    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      hasProfile: null,
      currentUserPubky: 'alice',
      grantSessionRecordId: 'alice:grant-1',
      sessionRestoreDeferred: true,
    });
    expect(JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!).state.hasProfile).toBe(null);
    vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true).mockClear();
    vi.mocked(BootstrapApplication.initialize).mockClear();
    await expect(AuthController.restorePersistedSession()).resolves.toEqual({ status: 'restored' });
    expect(AuthApplication.userIsSignedUp).toHaveBeenCalledWith({ pubky: 'alice' });
    expect(BootstrapApplication.initialize).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ session, hasProfile: true, sessionRestoreDeferred: false });
    expect(JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!).state.hasProfile).toBe(true);
    const { result } = renderHook(() => useAuthStatus());
    expect(result.current).toMatchObject({ status: AuthStatus.AUTHENTICATED, isLoading: false, hasKeypair: true });
  },
);

it('retires the previous grant after ordinary sign-in replaces an interrupted sign-in', async () => {
  const previous = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(previous);
  vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValueOnce(new Error('offline'));
  await expect(AuthController.initializeAuthenticatedSession({ session: previous })).rejects.toThrow('offline');
  expect(records.has('alice:old')).toBe(true);
  const replacement = grantSession('alice', 'shop.pubky.app', 'new');
  await approve(replacement);
  await AuthController.initializeAuthenticatedSession({ session: replacement });
  expect(useAuthStore.getState().grantSessionRecordId).toBe('alice:new');
  expect(pendingOwnedGrants()).toEqual([]);
  await AuthController.logout();
  await AuthController.settlePendingGrantKeyCleanup();
  expect(records.has('alice:new')).toBe(false);
  expect(records.has('alice:old')).toBe(false);
  expect(previous.signout).toHaveBeenCalledOnce();
  expect(vi.mocked(previous.signout).mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
  expect(pendingOwnedGrants()).toEqual([]);
});

it('retains failed step-up retirement for a later cleanup after the new pointer is committed', async () => {
  const previous = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(previous);
  await AuthController.initializeAuthenticatedSession({ session: previous });
  const replacement = grantSession('alice', 'shop.pubky.app', 'new');
  await approve(replacement);
  remove.mockImplementation(async (id: string) => {
    if (id === 'alice:old') throw new Error('temporary blocked deletion');
    records.delete(id);
  });
  await expect(AuthController.completeStepUpReauth({ session: replacement })).resolves.toBeUndefined();
  expect(useAuthStore.getState().grantSessionRecordId).toBe('alice:new');
  expect(pendingOwnedGrants()).toMatchObject([{ kind: 'retirement', id: 'alice:old' }]);
  remove.mockImplementation(async (id: string) => {
    records.delete(id);
  });
  await AuthController.logout();
  await AuthController.settlePendingGrantKeyCleanup();
  expect(records.has('alice:new')).toBe(false);
  expect(records.has('alice:old')).toBe(false);
  expect(pendingOwnedGrants()).toEqual([]);
});

it.each(['profile', 'bootstrap'] as const)(
  'defers another transient %s recovery failure without erasing its credential or completion marker',
  async (failureAt) => {
    const session = grantSession();
    await approve(session);
    if (failureAt === 'profile') vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValue(new Error('offline'));
    else {
      vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
      vi.mocked(BootstrapApplication.initialize).mockRejectedValue(new Error('offline'));
    }
    await expect(AuthController.initializeAuthenticatedSession({ session })).rejects.toThrow('offline');
    await expect(AuthController.restorePersistedSession()).resolves.toEqual({ status: 'deferred' });
    expect(records.has('alice:grant-1')).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({ session: null, hasProfile: null, sessionRestoreDeferred: true });
    expect(session.signout).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  },
);

it.each(['logout', 'replacement'] as const)('fences incomplete-profile recovery after %s', async (change) => {
  const old = grantSession();
  await approve(old);
  vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValueOnce(new Error('offline'));
  await expect(AuthController.initializeAuthenticatedSession({ session: old })).rejects.toThrow('offline');
  const profile = deferred<boolean>();
  vi.mocked(AuthApplication.userIsSignedUp).mockReturnValueOnce(profile.promise);
  const restoring = AuthController.restorePersistedSession();
  await vi.waitFor(() => expect(useAuthStore.getState().session).toBe(old));
  if (change === 'logout') await AuthController.logout();
  else {
    const next = grantSession('bob', 'shop.pubky.app', 'next');
    await approve(next);
    await AuthController.initializeAuthenticatedSession({ session: next });
  }
  profile.resolve(true);
  await expect(restoring).resolves.toEqual({ status: 'signed-out' });
  expect(useAuthStore.getState().currentUserPubky).toBe(change === 'logout' ? null : 'bob');
  expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
});

it('keeps the new grant usable while remote retirement is offline and retries before deleting the old key', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  vi.mocked(old.signout).mockRejectedValue(new Error('offline'));
  const next = grantSession('alice', 'shop.pubky.app', 'next');
  await approve(next);
  await AuthController.initializeAuthenticatedSession({ session: next });
  expect(useAuthStore.getState().session).toBe(next);
  expect(records.has('alice:old')).toBe(true);
  expect(remove).not.toHaveBeenCalledWith('alice:old');
  expect(pendingOwnedGrants()).toMatchObject([{ kind: 'retirement', id: 'alice:old' }]);
  vi.mocked(old.signout).mockResolvedValue();
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(true);
  expect(records.has('alice:old')).toBe(false);
  expect(records.has('alice:next')).toBe(true);
  expect(next.signout).not.toHaveBeenCalled();
});

it('does not revoke a queued predecessor while a failed replacement leaves it as the active pointer', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  AuthApplication.queueGrantRetirement('alice:old');
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(true);
  expect(records.has('alice:old')).toBe(true);
  expect(old.signout).not.toHaveBeenCalled();
  expect(pendingOwnedGrants()).toMatchObject([{ kind: 'retirement', id: 'alice:old' }]);
});

it('fails closed if a queued reference resolves to an App-owned grant', async () => {
  const host = grantSession('alice', 'pubky.app', 'host');
  records.set('alice:host', host);
  AuthApplication.queueGrantRetirement('alice:host');
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(false);
  expect(records.has('alice:host')).toBe(true);
  expect(host.signout).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('keeps the previous pointer when its retirement obligation cannot be stored', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  const next = grantSession('alice', 'shop.pubky.app', 'next');
  await approve(next);
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
    if (name.startsWith('shop-owned-grant-v1:retirement:')) throw new Error('quota');
    return originalSet.call(this, name, value);
  });
  await expect(AuthController.initializeAuthenticatedSession({ session: next })).rejects.toThrow(
    'Browser storage is blocked',
  );
  expect(useAuthStore.getState()).toMatchObject({ session: old, grantSessionRecordId: 'alice:old' });
  expect(JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!).state.grantSessionRecordId).toBe('alice:old');
  expect(records.has('alice:old')).toBe(true);
  expect(old.signout).not.toHaveBeenCalled();
  expect(records.has('alice:next')).toBe(false);
  expect(next.signout).toHaveBeenCalledOnce();
});

it.each(['logout', 'replacement'] as const)(
  'serializes recovered bootstrap writes before %s cleanup',
  async (change) => {
    const old = grantSession();
    await approve(old);
    vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValueOnce(new Error('offline'));
    await expect(AuthController.initializeAuthenticatedSession({ session: old })).rejects.toThrow('offline');
    vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValueOnce(true);
    const bootstrap = deferred<Awaited<ReturnType<typeof BootstrapApplication.initialize>>>();
    vi.mocked(BootstrapApplication.initialize).mockReturnValueOnce(bootstrap.promise);
    const next = grantSession('bob', 'shop.pubky.app', 'next');
    const order: string[] = [];
    vi.mocked(clearDatabase).mockImplementation(async () => {
      order.push('cleanup');
    });
    const restoring = AuthController.restorePersistedSession();
    await vi.waitFor(() => expect(BootstrapApplication.initialize).toHaveBeenCalled());
    let changing: Promise<unknown>;
    if (change === 'logout') changing = AuthController.logout();
    else changing = approve(next).then(() => AuthController.initializeAuthenticatedSession({ session: next }));
    expect(order).toEqual([]);
    order.push('bootstrap');
    bootstrap.resolve(asOpaque({}));
    await changing;
    await expect(restoring).resolves.toEqual({ status: change === 'logout' ? 'signed-out' : 'restored' });
    expect(order).toEqual(['bootstrap', 'cleanup']);
    expect(useAuthStore.getState().currentUserPubky).toBe(change === 'logout' ? null : 'bob');
    expect(useAuthStore.getState().hasProfile).toBe(change === 'logout' ? null : false);
  },
);

it.each(['direct', 'cross-tab'] as const)(
  'a delayed old %s logout keeps a new same-account grant and its completed profile',
  async (logoutKind) => {
    const old = grantSession('alice', 'shop.pubky.app', 'old');
    await approve(old);
    await AuthController.initializeAuthenticatedSession({ session: old });
    const remoteLogout = deferred<void>();
    vi.mocked(old.signout).mockReturnValue(remoteLogout.promise);
    const loggingOut = logoutKind === 'direct' ? AuthController.logout() : AuthController.handleCrossTabSignOut();
    await vi.waitFor(() => expect(old.signout).toHaveBeenCalled());
    const next = grantSession('alice', 'shop.pubky.app', 'next');
    await approve(next);
    const signingIn = AuthController.initializeAuthenticatedSession({ session: next });
    await vi.waitFor(() => expect(useAuthStore.getState().session).toBe(next));
    remoteLogout.resolve();
    await Promise.all([signingIn, loggingOut]);
    expect(records.has('alice:old')).toBe(false);
    expect(records.has('alice:next')).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({
      session: next,
      grantSessionRecordId: 'alice:next',
      hasProfile: false,
      isLoggingOut: false,
    });
    expect(next.signout).not.toHaveBeenCalled();
  },
);

it('does not complete recovery or resurrect the saved pointer after another tab advances logout', async () => {
  const session = grantSession();
  await approve(session);
  vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValueOnce(new Error('offline'));
  await expect(AuthController.initializeAuthenticatedSession({ session })).rejects.toThrow('offline');
  const profile = deferred<boolean>();
  vi.mocked(AuthApplication.userIsSignedUp).mockReturnValueOnce(profile.promise);
  const restoring = AuthController.restorePersistedSession();
  await vi.waitFor(() => expect(useAuthStore.getState().session).toBe(session));
  // Another tab completed logout in the shared finalization lock; its
  // broadcast may not have reached this tab before the network result does.
  bumpAuthEpoch();
  clearPersistedAuthIdentity();
  profile.resolve(true);
  await expect(restoring).resolves.toEqual({ status: 'signed-out' });
  expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
  expect(useAuthStore.getState().isRestoringSession).toBe(false);
  expect(localStorage.getItem(AUTH_PERSIST_KEY)).toBeNull();
});

it.each(['Browser session is no longer valid.', 'Browser session was signed out.'])(
  'retires a stored SDK terminal credential (%s) without poisoning later logout',
  async (message) => {
    const old = grantSession('alice', 'shop.pubky.app', 'old');
    await approve(old);
    await AuthController.initializeAuthenticatedSession({ session: old });
    const sdk = asOpaque<{ getPubkySdk: () => Pubky }>(HomeserverService).getPubkySdk();
    vi.mocked(sdk.browserSessionStore.restore).mockImplementation(async (id) => {
      if (id === 'alice:old') throw Object.assign(new Error(message), { name: 'ClientStateError' });
      return records.get(id)!;
    });
    const next = grantSession('alice', 'shop.pubky.app', 'next');
    await approve(next);
    await AuthController.initializeAuthenticatedSession({ session: next });
    expect(records.has('alice:old')).toBe(false);
    expect(pendingOwnedGrants()).toEqual([]);
    await AuthController.logout();
    expect(useAuthStore.getState().currentUserPubky).toBeNull();
    expect(records.size).toBe(0);
  },
);

it('finishes local logout while preserving an offline predecessor retirement for retry', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  vi.mocked(old.signout).mockRejectedValue(new Error('offline'));
  const next = grantSession('alice', 'shop.pubky.app', 'next');
  await approve(next);
  await AuthController.initializeAuthenticatedSession({ session: next });
  const clearServices = vi.spyOn(CommerceController, 'clearMarketplaceSessionForSignOut');
  await AuthController.logout();
  expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: null, session: null, grantSessionRecordId: null });
  expect(clearServices).toHaveBeenCalled();
  expect(records.has('alice:old')).toBe(true);
  expect(records.has('alice:next')).toBe(false);
  expect(pendingOwnedGrants()).toMatchObject([{ kind: 'retirement', id: 'alice:old' }]);
  vi.mocked(old.signout).mockResolvedValue();
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(true);
  expect(records.size).toBe(0);
});

it('clears local authority after failed remote logout but keeps its exact revocation obligation', async () => {
  const session = grantSession();
  await approve(session);
  await AuthController.initializeAuthenticatedSession({ session });
  vi.mocked(session.signout).mockRejectedValue(new Error('offline'));
  await AuthController.logout();
  expect(useAuthStore.getState()).toMatchObject({ session: null, currentUserPubky: null, grantSessionRecordId: null });
  expect(records.has('alice:grant-1')).toBe(true);
  expect(pendingOwnedGrants()).toMatchObject([{ kind: 'retirement', id: 'alice:grant-1' }]);
  vi.mocked(session.signout).mockResolvedValue();
  await AuthController.settlePendingGrantKeyCleanup();
  expect(records.size).toBe(0);
});

it.each(['alice', 'bob'])('preserves settings only when replacing with the same identity (%s)', async (pubky) => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  useSettingsStore.getState().setHideSearch(true);
  useSettingsStore.getState().setMutedUsers(['muted-by-alice']);
  useSearchStore.getState().addTag('alice-private-search');
  vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
  vi.mocked(SettingsApplication.initializeSettings).mockClear();
  const next = grantSession(pubky, 'shop.pubky.app', 'next');
  await approve(next);
  await AuthController.initializeAuthenticatedSession({ session: next });
  const settings = useSettingsStore.getState();
  expect(settings.privacy.hideSearch).toBe(pubky === 'alice');
  expect(settings.muted).toEqual(pubky === 'alice' ? ['muted-by-alice'] : []);
  expect(useSearchStore.getState().recentTags.map((entry) => entry.tag)).toEqual(
    pubky === 'alice' ? ['alice-private-search'] : [],
  );
  if (pubky === 'bob') expect(SettingsApplication.initializeSettings).toHaveBeenCalledWith('bob', settingsInitialState);
  useSettingsStore.getState().reset();
  useSearchStore.getState().reset();
});

it('does not let a record-removal marker erase the key of an unresolved retirement', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  records.set('alice:old', old);
  vi.mocked(old.signout).mockRejectedValue(new Error('offline'));
  const { rememberOwnedGrant } = await import('@/services/homeserver/owned-grant-storage');
  rememberOwnedGrant('retirement', 'alice:old');
  rememberOwnedGrant('record', 'alice:old');
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(false);
  expect(records.has('alice:old')).toBe(true);
  expect(remove).not.toHaveBeenCalled();
  vi.mocked(old.signout).mockResolvedValue();
  expect(await AuthController.settlePendingGrantKeyCleanup()).toBe(true);
  expect(records.size).toBe(0);
  expect(pendingOwnedGrants()).toEqual([]);
});

it('signs out a newer same-account grant that was already persisted before the stale tab logout', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  const next = grantSession('alice', 'shop.pubky.app', 'next');
  records.set('alice:next', next);
  const raw = JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!);
  raw.state.grantSessionRecordId = 'alice:next';
  localStorage.setItem(AUTH_PERSIST_KEY, JSON.stringify(raw));
  await AuthController.logout();
  expect(useAuthStore.getState().currentUserPubky).toBeNull();
  expect(localStorage.getItem(AUTH_PERSIST_KEY)).not.toContain('alice:next');
  expect(records.size).toBe(0);
  expect(next.signout).toHaveBeenCalledOnce();
});

it("clears commerce view state and the other account's chat sessions when another account signs in", async () => {
  const old = grantSession();
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  useCommerceStore.getState().setQuery('boots');
  const keepOnly = vi.spyOn(ChatController, 'clearSessionsOfOtherAccounts').mockImplementation(() => {});
  const next = grantSession('bob', 'shop.pubky.app', 'next');
  await approve(next);
  await AuthController.initializeAuthenticatedSession({ session: next });
  expect(useCommerceStore.getState().query).toBe('');
  expect(keepOnly).toHaveBeenCalledWith('bob');
  keepOnly.mockRestore();
});

it('ends the chat session and wipes its cache on sign-out, before the database clear', async () => {
  const session = grantSession();
  await approve(session);
  await AuthController.initializeAuthenticatedSession({ session });
  const wipe = vi.spyOn(ChatController, 'clearForSignOut').mockResolvedValue();
  await AuthController.logout();
  expect(wipe).toHaveBeenCalledWith('alice');
  const dbClear = vi.mocked(clearDatabase);
  expect(dbClear).toHaveBeenCalled();
  expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(dbClear.mock.invocationCallOrder.at(-1) ?? Infinity);
  wipe.mockRestore();
});

it('adopts a renewed same-account grant in another tab before using the retired grant again', async () => {
  const old = grantSession('alice', 'shop.pubky.app', 'old');
  await approve(old);
  await AuthController.initializeAuthenticatedSession({ session: old });
  const next = grantSession('alice', 'shop.pubky.app', 'next');
  records.set('alice:next', next);
  const persisted = JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!);
  persisted.state.grantSessionRecordId = 'alice:next';
  persisted.state.hasProfile = false;
  localStorage.setItem(AUTH_PERSIST_KEY, JSON.stringify(persisted));

  const unsubscribe = AuthController.subscribeCrossTabSignOut();
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_PERSIST_KEY }));
    await vi.waitFor(() => expect(useAuthStore.getState().session).toBe(next));
    expect(useAuthStore.getState().grantSessionRecordId).toBe('alice:next');
    expect(next.signout).not.toHaveBeenCalled();
    expect(clearDatabase).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});
