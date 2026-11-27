import type { ZustandSet } from '../stores.types';
import { SignInActionTypes, signInInitialState, SignInStore } from './signIn.types';

export const createSignInActions = (set: ZustandSet<SignInStore>) => ({
  setAuthUrlResolved: (value: boolean) =>
    set({ authUrlResolved: value }, false, SignInActionTypes.SET_AUTH_URL_RESOLVED),

  setProfileChecked: (value: boolean) => set({ profileChecked: value }, false, SignInActionTypes.SET_PROFILE_CHECKED),

  setMarketReady: (value: boolean) => set({ marketReady: value }, false, SignInActionTypes.SET_MARKET_READY),

  reset: () => set(signInInitialState, false, SignInActionTypes.RESET),
});
