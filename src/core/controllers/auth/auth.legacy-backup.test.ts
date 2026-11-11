import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { clearDatabase, clearPrivateData } from '@/database/franky/franky.helpers';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { ONBOARDING_PERSIST_KEY } from '@/stores/persistedKeys';
import { AuthController } from './auth';
import { approve, grantSession, resetGrantTest } from './auth.grant-test-utils';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));

const legacySecrets = {
  secretKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
};

function expectLegacyBackupAvailable() {
  expect(useOnboardingStore.getState()).toMatchObject(legacySecrets);
  expect(useOnboardingStore.getState().selectSecretKey()).toBe(legacySecrets.secretKey);
  expect(JSON.parse(localStorage.getItem(ONBOARDING_PERSIST_KEY)!).state).toMatchObject(legacySecrets);
}

describe('legacy backup retention through authentication', () => {
  beforeEach(() => {
    resetGrantTest();
    vi.mocked(clearDatabase).mockClear();
    vi.mocked(clearPrivateData).mockClear();
    useOnboardingStore.setState({ ...legacySecrets, hasHydrated: true });
  });
  afterEach(() => {
    AuthController.cancelAllAuthFlows();
    useOnboardingStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('keeps a saved key accessible with no account or restorable session', async () => {
    vi.spyOn(AuthApplication, 'restorePersistedSession').mockResolvedValue({ status: 'signed-out' });

    await expect(AuthController.restorePersistedSession()).resolves.toEqual({ status: 'signed-out' });

    expect(useAuthStore.getState().session).toBeNull();
    expectLegacyBackupAvailable();
  });

  it.each(['signed-out', 'deferred', 'failure'] as const)(
    'preserves legacy backup after a %s restore',
    async (outcome) => {
      useAuthStore.setState({ currentUserPubky: 'alice', grantSessionRecordId: 'alice:expired', hasProfile: true });
      const restore = vi.spyOn(AuthApplication, 'restorePersistedSession');
      if (outcome === 'failure') restore.mockRejectedValue(new Error('restore unavailable'));
      else restore.mockResolvedValue({ status: outcome });

      await AuthController.restorePersistedSession();

      expectLegacyBackupAvailable();
    },
  );

  it('explicit logout still discards backup after an automatic cleanup already completed', async () => {
    vi.spyOn(AuthApplication, 'restorePersistedSession').mockResolvedValue({ status: 'signed-out' });
    await AuthController.restorePersistedSession();
    expectLegacyBackupAvailable();

    await AuthController.logout();

    expect(useOnboardingStore.getState()).toMatchObject({ secretKey: null, mnemonic: null });
    expect(localStorage.getItem(ONBOARDING_PERSIST_KEY)).toBeNull();
  });

  it('clears in-memory backup on cross-tab logout even without a live identity', async () => {
    // Another tab removed the shared persisted keys; this tab still renders its hydrated backup.
    localStorage.removeItem(ONBOARDING_PERSIST_KEY);
    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      grantSessionRecordId: null,
      currentUserPubky: null,
    });

    await AuthController.handleCrossTabSignOut();

    expect(useOnboardingStore.getState()).toMatchObject({ secretKey: null, mnemonic: null });
    expect(localStorage.getItem(ONBOARDING_PERSIST_KEY)).toBeNull();
    expect(clearDatabase).not.toHaveBeenCalled();
    expect(clearPrivateData).not.toHaveBeenCalled();

    // A later hydration/state write must never put the old secret back into storage.
    await useOnboardingStore.persist.rehydrate();
    useOnboardingStore.getState().setHydrated(true);
    expect(useOnboardingStore.getState().selectHasSecretKey()).toBe(false);
    expect(useOnboardingStore.getState().selectHasMnemonic()).toBe(false);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_PERSIST_KEY)!).state).toMatchObject({
      secretKey: null,
      mnemonic: null,
    });
  });

  it('keeps backup material separate from the identity and profile authority of a new sign-in', async () => {
    const session = grantSession('another-account');
    await approve(session);
    await AuthController.initializeAuthenticatedSession({ session });

    expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: 'another-account', session, hasProfile: false });
    expectLegacyBackupAvailable();
  });
});
