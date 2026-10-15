'use client';

import { useIsShopHosted } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';

export const SIGN_OUT_COPY = {
  title: 'Sign out',
  host: 'Signs you out of Pubky App and the Shop in this browser.',
  grant: 'Signs you out of the Shop in this browser. pubky.app is not signed out.',
} as const;

/** The session owner determines which application handles sign-out. */
export function useSignOutCopy(): { title: string; description: string } {
  const hosted = useIsShopHosted();
  return { title: SIGN_OUT_COPY.title, description: hosted ? SIGN_OUT_COPY.host : SIGN_OUT_COPY.grant };
}
