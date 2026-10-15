'use client';

import { useCallback } from 'react';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { AuthState } from '@/stores/auth/auth.types';
import type { UseRequireAuthResult } from './useRequireAuth.types';

/**
 * Hook for handling authentication requirements in components.
 *
 * Provides:
 * - `isAuthenticated`: boolean indicating if user is logged in
 * - `requireAuth`: wrapper function that either executes the action or opens sign-in dialog
 *
 * The sign-in dialog state is managed globally in authStore.
 * DialogSignIn should be rendered once in the app layout, not in individual components.
 */
function hasAccountAuthority(state: AuthState): boolean {
  return Boolean(
    state.currentUserPubky &&
    state.session?.grant &&
    state.hasProfile === true &&
    !state.isRestoringSession &&
    !state.isLoggingOut,
  );
}

export function useRequireAuth(): UseRequireAuthResult {
  const isAuthenticated = useAuthStore(hasAccountAuthority);

  const requireAuth = useCallback(<T,>(action: () => T): T | undefined => {
    // Use getState() directly to avoid stale closure - auth state may change between
    // when this callback is created and when it's executed (e.g., user logs in/out)
    const state = useAuthStore.getState();
    if (hasAccountAuthority(state)) {
      return action();
    }
    if (!requestShopHostAction('request-login')) state.setShowSignInDialog(true);
    return undefined;
  }, []);

  return {
    isAuthenticated,
    requireAuth,
  };
}
