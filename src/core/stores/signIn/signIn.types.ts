export interface SignInState {
  /** Signer approval received; session setup and account checks may still be running. */
  authUrlResolved: boolean;
  /** Profile check completed */
  profileChecked: boolean;
  /** The Market session is ready */
  marketReady: boolean;
}

export interface SignInActions {
  setAuthUrlResolved: (value: boolean) => void;
  setProfileChecked: (value: boolean) => void;
  setMarketReady: (value: boolean) => void;
  reset: () => void;
}

export type SignInStore = SignInState & SignInActions;

export const signInInitialState: SignInState = {
  authUrlResolved: false,
  profileChecked: false,
  marketReady: false,
};

export enum SignInActionTypes {
  SET_AUTH_URL_RESOLVED = 'SET_AUTH_URL_RESOLVED',
  SET_PROFILE_CHECKED = 'SET_PROFILE_CHECKED',
  SET_MARKET_READY = 'SET_MARKET_READY',
  RESET = 'RESET',
}
