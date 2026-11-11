import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { ONBOARDING_PERSIST_KEY } from '../persistedKeys';
import { useOnboardingStore } from './onboarding.store';

const legacySecrets = {
  secretKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
};

function saveLegacyRecord(state: Record<string, unknown>) {
  localStorage.setItem(ONBOARDING_PERSIST_KEY, JSON.stringify({ state, version: 0 }));
}

describe('legacy onboarding backup storage', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    useOnboardingStore.getState().reset();
    localStorage.clear();
  });

  it('hydrates old secret fields unchanged under the original Shop key without reviving signup progress', async () => {
    expect(ONBOARDING_PERSIST_KEY).toBe('shop-onboarding-storage');
    saveLegacyRecord({ ...legacySecrets, inviteCode: 'old-invite', showWelcomeDialog: true, hasHydrated: false });

    await useOnboardingStore.persist.rehydrate();

    const state = useOnboardingStore.getState();
    expect(state).toMatchObject({ ...legacySecrets, hasHydrated: true });
    expect(state.selectHasSecretKey()).toBe(true);
    expect(state.selectHasMnemonic()).toBe(true);
    expect(state.selectSecretKey()).toBe(legacySecrets.secretKey);
    expect(state).not.toHaveProperty('inviteCode');
    expect(state).not.toHaveProperty('showWelcomeDialog');
    expect(JSON.parse(localStorage.getItem(ONBOARDING_PERSIST_KEY)!)).toEqual({
      state: { ...legacySecrets, hasHydrated: false },
      version: 0,
    });
  });

  it.each([
    [{ secretKey: legacySecrets.secretKey }, true, false],
    [{ mnemonic: legacySecrets.mnemonic }, false, true],
    [{ secretKey: 'invalid', mnemonic: 'invalid phrase' }, false, false],
    [{}, false, false],
  ] as const)('only offers exports available in a partial legacy record %j', async (record, hasKey, hasMnemonic) => {
    saveLegacyRecord(record);
    await useOnboardingStore.persist.rehydrate();

    expect(useOnboardingStore.getState().selectHasSecretKey()).toBe(hasKey);
    expect(useOnboardingStore.getState().selectHasMnemonic()).toBe(hasMnemonic);
  });

  it('keeps incomplete legacy strings at rest while refusing invalid secret export', async () => {
    saveLegacyRecord({ secretKey: 'incomplete legacy key', mnemonic: 'incomplete legacy phrase' });
    await useOnboardingStore.persist.rehydrate();

    expect(useOnboardingStore.getState()).toMatchObject({
      secretKey: 'incomplete legacy key',
      mnemonic: 'incomplete legacy phrase',
    });
    expect(() => useOnboardingStore.getState().selectSecretKey()).toThrow(
      expect.objectContaining({ code: ValidationErrorCode.INVALID_INPUT, context: undefined }),
    );
  });

  it.each(['clearSecrets', 'reset'] as const)(
    'clears saved material only when %s is explicitly invoked',
    async (action) => {
      saveLegacyRecord(legacySecrets);
      await useOnboardingStore.persist.rehydrate();

      useOnboardingStore.getState()[action]();

      expect(useOnboardingStore.getState()).toMatchObject({ secretKey: null, mnemonic: null, hasHydrated: true });
      expect(JSON.parse(localStorage.getItem(ONBOARDING_PERSIST_KEY)!).state).toEqual({
        secretKey: null,
        mnemonic: null,
        hasHydrated: false,
      });
    },
  );
});
