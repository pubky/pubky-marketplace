export interface OnboardingState {
  secretKey: string | null;
  mnemonic: string | null;
  /** Epoch ms when the secrets were saved, or null when there are none. */
  secretsSavedAt: number | null;
  hasHydrated: boolean;
  showWelcomeDialog: boolean;
  inviteCode: string;
}

/**
 * A pair of secret key and mnemonic
 */
export interface TOnboardingSecrets {
  secretKey: string;
  mnemonic: string;
}

export interface OnboardingActions {
  reset: () => void;
  setInviteCode: (inviteCode: string) => void;
  setSecrets: (secrets: TOnboardingSecrets) => void;
  clearSecrets: () => void;
  /** Restarts the onboarding lifetime of the stored secrets; does nothing when there are none. */
  restartSecretsLifetime: () => void;
  setHydrated: (hasHydrated: boolean) => void;
  setShowWelcomeDialog: (show: boolean) => void;
}

export interface OnboardingSelectors {
  selectSecretKey: () => string;
  selectMnemonic: () => string;
}

export type OnboardingStore = OnboardingState & OnboardingActions & OnboardingSelectors;

/** The onboarding state with the recovery phrase, secret key and their save time removed. */
export const onboardingClearedSecrets = {
  secretKey: null,
  mnemonic: null,
  secretsSavedAt: null,
} satisfies Partial<OnboardingState>;

export const onboardingInitialState: OnboardingState = {
  secretKey: null,
  mnemonic: null,
  secretsSavedAt: null,
  hasHydrated: false,
  showWelcomeDialog: false,
  inviteCode: '',
};

export enum OnboardingActionTypes {
  RESET = 'RESET',
  SET_SECRETS = 'SET_SECRETS',
  CLEAR_SECRETS = 'CLEAR_SECRETS',
  RESTART_SECRETS_LIFETIME = 'RESTART_SECRETS_LIFETIME',
  SET_HYDRATED = 'SET_HYDRATED',
  SET_SHOW_WELCOME_DIALOG = 'SET_SHOW_WELCOME_DIALOG',
  SET_INVITE_CODE = 'SET_INVITE_CODE',
  SET_SECRET_KEY = 'SET_SECRET_KEY',
  SET_MNEMONIC = 'SET_MNEMONIC',
  SET_KEYPAIR_FROM_MNEMONIC = 'SET_KEYPAIR_FROM_MNEMONIC',
}
