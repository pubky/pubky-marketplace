import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { ONBOARDING_SECRETS_TTL_MS } from '@/config/onboarding';
import { ONBOARDING_PERSIST_KEY } from '../persistedKeys';
import { createOnboardingActions } from './onboarding.actions';
import { createOnboardingSelectors } from './onboarding.selectors';
import {
  onboardingClearedSecrets,
  onboardingInitialState,
  type OnboardingState,
  type OnboardingStore,
} from './onboarding.types';

type StoredOnboardingState = Partial<OnboardingState>;

const hasSecrets = (stored: StoredOnboardingState): boolean => Boolean(stored.secretKey || stored.mnemonic);

/** True when stored secrets have no save time or were saved at least the onboarding lifetime ago. */
const secretsExpired = (stored: StoredOnboardingState): boolean => {
  if (!hasSecrets(stored)) return false;
  const savedAt = stored.secretsSavedAt;
  return typeof savedAt !== 'number' || Date.now() - savedAt >= ONBOARDING_SECRETS_TTL_MS;
};

// Store creation
export const useOnboardingStore = create<OnboardingStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...onboardingInitialState,
        ...createOnboardingActions(set),
        ...createOnboardingSelectors(get),
      }),
      {
        name: ONBOARDING_PERSIST_KEY,
        version: 1,

        // Persist keys data
        partialize: (state) => ({
          secretKey: state.secretKey,
          mnemonic: state.mnemonic,
          secretsSavedAt: state.secretsSavedAt,
          showWelcomeDialog: state.showWelcomeDialog,
          inviteCode: state.inviteCode,
          hasHydrated: false, // Will be set by rehydration handler
        }),

        // Version 0 entries have no save time: start their lifetime at the first load after upgrade.
        migrate: (persisted, fromVersion): StoredOnboardingState => {
          const stored = (persisted ?? {}) as StoredOnboardingState;
          if (fromVersion >= 1) return stored;
          return { ...stored, secretsSavedAt: hasSecrets(stored) ? Date.now() : null };
        },

        // Limit how long the recovery phrase and secret key stay in browser storage: expired
        // secrets never reach memory, and the setHydrated write below rewrites the entry without them.
        // A save time in the future (the device clock was ahead and has since been corrected) counts
        // from now, so the secrets never stay longer than the onboarding lifetime.
        merge: (persisted, current) => {
          const stored = (persisted ?? {}) as StoredOnboardingState;
          const merged = { ...current, ...stored };
          if (secretsExpired(stored)) return { ...merged, ...onboardingClearedSecrets };
          const now = Date.now();
          if (hasSecrets(stored) && (stored.secretsSavedAt ?? 0) > now) return { ...merged, secretsSavedAt: now };
          return merged;
        },

        // Set hasHydrated to true after rehydration
        onRehydrateStorage: () => (state) => {
          if (state) {
            state.setHydrated(true);
          }
        },
      },
    ),
    {
      name: 'onboarding-store',
      enabled: process.env.NODE_ENV === 'development',
    },
  ),
);
