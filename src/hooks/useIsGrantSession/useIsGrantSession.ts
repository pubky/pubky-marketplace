'use client';

import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * Whether an active SDK grant session is present. All supported Shop sign-in
 * methods use grants; the session is absent before authentication or during cleanup.
 */
export function useIsGrantSession(): boolean {
  return useAuthStore((state) => state.session != null && state.session.grant !== undefined);
}
