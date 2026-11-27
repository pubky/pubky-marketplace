import { beforeEach, describe, expect, it } from 'vitest';
import { useSignInStore } from './signIn.store';

describe('SignInStore', () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    useSignInStore.getState().reset();
  });

  describe('Initial State', () => {
    it('should have all flags set to false initially', () => {
      const state = useSignInStore.getState();

      expect(state.authUrlResolved).toBe(false);
      expect(state.profileChecked).toBe(false);
      expect(state.marketReady).toBe(false);
    });
  });

  describe('Step Actions', () => {
    it('should set authUrlResolved to true', () => {
      useSignInStore.getState().setAuthUrlResolved(true);
      expect(useSignInStore.getState().authUrlResolved).toBe(true);
    });

    it('should set profileChecked to true', () => {
      useSignInStore.getState().setProfileChecked(true);
      expect(useSignInStore.getState().profileChecked).toBe(true);
    });

    it('should set marketReady to true', () => {
      useSignInStore.getState().setMarketReady(true);
      expect(useSignInStore.getState().marketReady).toBe(true);
    });

    it('should track progress through all steps', () => {
      const store = useSignInStore.getState();

      store.setAuthUrlResolved(true);
      expect(useSignInStore.getState().authUrlResolved).toBe(true);

      store.setProfileChecked(true);
      expect(useSignInStore.getState().profileChecked).toBe(true);

      store.setMarketReady(true);
      expect(useSignInStore.getState().marketReady).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should reset all state to initial values', () => {
      const store = useSignInStore.getState();

      // Set all state
      store.setAuthUrlResolved(true);
      store.setProfileChecked(true);
      store.setMarketReady(true);

      // Reset
      store.reset();

      // Verify all reset
      const resetState = useSignInStore.getState();
      expect(resetState.authUrlResolved).toBe(false);
      expect(resetState.profileChecked).toBe(false);
      expect(resetState.marketReady).toBe(false);
    });
  });
});
