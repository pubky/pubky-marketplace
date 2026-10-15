'use client';

import { getPassportSignInEnabled } from '@/libs/runtime-config/runtime-config';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { GrantSigner } from '@/stores/auth/auth.types';

/** The recorded signer behind a grant session; unknown hosted sessions require a choice. */
export function readGrantSigner(state: {
  session: { grant?: unknown } | null;
  grantSigner: GrantSigner | null;
}): GrantSigner | null {
  if (!state.session || state.session.grant === undefined) return null;
  return state.grantSigner ?? 'host';
}

/**
 * Which signer approved the signed-in grant session. Local-key and host
 * sessions choose a signer explicitly for separate marketplace approvals.
 */
export function useGrantSigner(): GrantSigner | null {
  return useAuthStore(readGrantSigner);
}

/**
 * A Passport sign-in while the deploy switched Passport off
 * (`PUBKY_RUNTIME_PASSPORT_SIGN_IN=false`): no Passport approval may start, so
 * its purchase approval is refused like a grant sign-in with the grant flow off.
 */
export function isPassportApprovalRefused(): boolean {
  return readGrantSigner(useAuthStore.getState()) === 'passport' && !getPassportSignInEnabled();
}
