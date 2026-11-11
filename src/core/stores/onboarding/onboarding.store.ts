import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { ONBOARDING_PERSIST_KEY } from '../persistedKeys';
import { createOnboardingActions } from './onboarding.actions';
import { createOnboardingSelectors } from './onboarding.selectors';
import { onboardingInitialState, type OnboardingStore } from './onboarding.types';

// Preserve the original store/key so previously generated secrets remain exportable.
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

        // Keep the existing secret fields without creating or migrating key material.
        partialize: (state) => ({
          secretKey: state.secretKey,
          mnemonic: state.mnemonic,
          hasHydrated: false, // Will be set by rehydration handler
        }),

        // Retired progress/welcome fields never enter the live store. The stored secret
        // strings are carried forward unchanged, including incomplete legacy records.
        merge: (persisted, current) => {
          if (!persisted || typeof persisted !== 'object') return current;
          return {
            ...current,
            secretKey: 'secretKey' in persisted && typeof persisted.secretKey === 'string' ? persisted.secretKey : null,
            mnemonic: 'mnemonic' in persisted && typeof persisted.mnemonic === 'string' ? persisted.mnemonic : null,
          };
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
