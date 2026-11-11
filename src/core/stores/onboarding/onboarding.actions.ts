import { type ZustandSet } from '../stores.types';
import {
  type OnboardingActions,
  OnboardingActionTypes,
  onboardingInitialState,
  type OnboardingStore,
} from './onboarding.types';

export const createOnboardingActions = (set: ZustandSet<OnboardingStore>): OnboardingActions => ({
  reset: () => {
    set(
      (state) => ({
        ...onboardingInitialState,
        hasHydrated: state.hasHydrated, // Preserve hydration state during reset
      }),
      false,
      OnboardingActionTypes.RESET,
    );
  },

  clearSecrets: () => {
    set({ secretKey: null, mnemonic: null }, false, OnboardingActionTypes.CLEAR_SECRETS);
  },

  setHydrated: (hasHydrated: boolean) => {
    set({ hasHydrated }, false, OnboardingActionTypes.SET_HYDRATED);
  },
});
