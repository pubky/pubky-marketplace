/** Legacy backup material retained from accounts created before Shop signup was retired. */
export interface OnboardingState {
  secretKey: string | null;
  mnemonic: string | null;
  hasHydrated: boolean;
}

export interface OnboardingActions {
  reset: () => void;
  clearSecrets: () => void;
  setHydrated: (hasHydrated: boolean) => void;
}

export interface OnboardingSelectors {
  selectSecretKey: () => string;
  selectHasSecretKey: () => boolean;
  selectHasMnemonic: () => boolean;
}

export type OnboardingStore = OnboardingState & OnboardingActions & OnboardingSelectors;

export const onboardingInitialState: OnboardingState = {
  secretKey: null,
  mnemonic: null,
  hasHydrated: false,
};

export enum OnboardingActionTypes {
  RESET = 'RESET',
  CLEAR_SECRETS = 'CLEAR_SECRETS',
  SET_HYDRATED = 'SET_HYDRATED',
}
