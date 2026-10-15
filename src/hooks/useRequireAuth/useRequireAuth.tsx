'use client';

import { useCallback, useEffect, useRef } from 'react';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { AuthState, AuthStore } from '@/stores/auth/auth.types';
import type { UseRequireAuthResult } from './useRequireAuth.types';

/**
 * How long a click waits for a saved grant to restore before the user is sent
 * to sign in. A restore that settles earlier ends the wait at once; this only
 * bounds a restore that never reports back, so a click is never swallowed.
 */
export const REQUIRE_AUTH_RESTORE_TIMEOUT_MS = 15_000;

/**
 * Hook for handling authentication requirements in components.
 *
 * Provides:
 * - `isAuthenticated`: boolean indicating if user is logged in
 * - `requireAuth`: wrapper function that runs the action, queues it while a saved
 *   session is still restoring, or opens the sign-in dialog for a signed-out user
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

/**
 * A saved grant is being restored: right after a full page load the store knows who
 * the user is, but the live session only exists once the SDK record, the profile and
 * the bootstrap finish. Such a user is signed in, so the sign-up prompt must not show.
 */
function isRestorePending(state: AuthState): boolean {
  if (state.isLoggingOut) return false;
  if (state.isRestoringSession) return true;
  return Boolean(state.grantSessionRecordId) && state.session === null && !state.sessionRestoreDeferred;
}

function promptSignIn(state: AuthStore): void {
  if (!requestShopHostAction('request-login')) state.setShowSignInDialog(true);
}

export function useRequireAuth(): UseRequireAuthResult {
  const isAuthenticated = useAuthStore(hasAccountAuthority);
  const queuedRef = useRef(new Set<() => void>());

  useEffect(() => {
    const queued = queuedRef.current;
    return () => {
      for (const finish of [...queued]) finish();
    };
  }, []);

  const requireAuth = useCallback(<T,>(action: () => T): T | undefined => {
    // Use getState() directly to avoid stale closure - auth state may change between
    // when this callback is created and when it's executed (e.g., user logs in/out)
    const state = useAuthStore.getState();
    if (hasAccountAuthority(state)) {
      return action();
    }
    if (!isRestorePending(state)) {
      promptSignIn(state);
      return undefined;
    }

    // The click is kept and replayed when the restore settles: signed in runs it,
    // signed out (or a restore that gave up) is the only case that prompts.
    const queued = queuedRef.current;
    let unsubscribe: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      unsubscribe();
      clearTimeout(timer);
      queued.delete(finish);
    };
    const settle = () => {
      const current = useAuthStore.getState();
      if (hasAccountAuthority(current)) {
        finish();
        void action();
        return;
      }
      if (current.isLoggingOut) {
        finish();
        return;
      }
      if (!isRestorePending(current)) {
        finish();
        promptSignIn(current);
      }
    };
    queued.add(finish);
    unsubscribe = useAuthStore.subscribe(settle);
    timer = setTimeout(() => {
      finish();
      promptSignIn(useAuthStore.getState());
    }, REQUIRE_AUTH_RESTORE_TIMEOUT_MS);
    return undefined;
  }, []);

  return {
    isAuthenticated,
    requireAuth,
  };
}
