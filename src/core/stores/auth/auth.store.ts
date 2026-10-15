import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { shouldAttemptSessionRestore } from '@/libs/vibe-session/should-restore';
import { AUTH_PERSIST_KEY } from '../persistedKeys';
import { createAuthActions } from './auth.actions';
import { createOwnerGuardedAuthJSONStorage } from './auth.persisted';
import { createAuthSelectors } from './auth.selectors';
import { authInitialState, AuthStore } from './auth.types';

/** Isolated persist-backed auth store. Tests use a second instance to model another tab sharing `AUTH_PERSIST_KEY`. */
export function createAuthStore() {
  return create<AuthStore>()(
    devtools(
      persist(
        (set, get) => ({
          ...authInitialState,
          ...createAuthActions(set),
          ...createAuthSelectors(get),
        }),
        {
          name: AUTH_PERSIST_KEY,
          storage: createOwnerGuardedAuthJSONStorage(),
          // Only persist essential data
          partialize: (state) => ({
            currentUserPubky: state.sessionOwner === 'host' ? null : state.currentUserPubky,
            sessionExport: state.sessionExport,
            grantSessionRecordId: state.sessionOwner === 'host' ? null : state.grantSessionRecordId,
            grantSigner: state.sessionOwner === 'host' ? null : state.grantSigner,
            hasProfile: state.sessionOwner === 'host' ? null : state.hasProfile,
            hasHydrated: false, // Will be set by rehydration handler
          }),

          merge: (persisted, current) => {
            // Zustand calls merge with undefined on the first visit. Finish
            // normal hydration before any hosted session or private route starts.
            const restored: Partial<AuthStore> =
              persisted && typeof persisted === 'object' && !Array.isArray(persisted) ? { ...persisted } : {};
            // Explicit migration: pre-signer grant records were created by Bitkit.
            if (restored.grantSessionRecordId && !restored.grantSigner) restored.grantSigner = 'bitkit';
            return { ...current, ...restored, sessionOwner: restored.grantSessionRecordId ? 'shop' : null };
          },
          // Set hasHydrated to true after rehydration
          onRehydrateStorage: (state) => (rehydratedState) => {
            const resolvedState = rehydratedState ?? state;
            resolvedState.setHasHydrated(true);
            if (
              shouldAttemptSessionRestore(rehydratedState?.sessionExport) ||
              Boolean(rehydratedState?.grantSessionRecordId)
            ) {
              resolvedState.setIsRestoringSession(true);
            }
          },
        },
      ),
      {
        name: 'auth-store',
        enabled: process.env.NODE_ENV === 'development',
      },
    ),
  );
}

export const useAuthStore = createAuthStore();
