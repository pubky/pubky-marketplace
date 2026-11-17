'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthController } from '@/controllers/auth/auth';
import { toSignerDeepLink } from '@/libs/navigation/bitkit-ios-url';
import { navigateTop } from '@/libs/navigation/navigate-top';
import { useAuthUrl } from '../useAuthUrl/useAuthUrl';
import type { UseAuthUrlOptions } from '../useAuthUrl/useAuthUrl.types';

export type SignInSigner = 'ring' | 'bitkit';

type UseMobileAuthReturn = {
  url: string;
  isLoading: boolean;
  isExpired: boolean;
  fetchUrl: () => Promise<void>;
  copyAuthUrl: () => Promise<void>;
  isOpeningRing: boolean;
  /** The signer whose Authorize button opened the app, so only that button shows the launch state. */
  openingSigner: SignInSigner | null;
  /** Opens the approval URL as is, for a sign-up or a signer that needs no rewrite. */
  onAuthorizeClick: () => void;
  /** Opens the approval URL in one phone signer and records that choice for the sign-in. */
  authorizeWith: (signer: SignInSigner) => void;
};

/**
 * Manages mobile auth flow via deeplink navigation.
 * Resets the opening state when the page becomes hidden (app opened successfully).
 * `authorizeWith('bitkit')` opens Bitkit's own `bitkit://` link on iOS: Bitkit iOS
 * leaves `pubkyauth://` to Pubky Ring. Every other signer and platform opens the
 * `pubkyauth://` URL, and the QR and copied link always stay `pubkyauth://`.
 */
export function useMobileAuth(options: UseAuthUrlOptions = {}): UseMobileAuthReturn {
  const { url, isLoading, isExpired, fetchUrl, copyAuthUrl } = useAuthUrl(options);
  const [opening, setOpening] = useState<SignInSigner | 'other' | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isLoading) {
      setOpening(null);
    }
  }, [isLoading]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const open = (signer: SignInSigner | null) => {
    if (isLoading) return;

    if (!url) {
      cleanup();
      setOpening(null);
      void fetchUrl();
      return;
    }

    cleanup();
    setOpening(signer ?? 'other');

    const onVisibilityChange = () => {
      if (document.hidden) {
        cleanup();
        setOpening(null);
      }
    };
    visibilityHandlerRef.current = onVisibilityChange;

    document.addEventListener('visibilitychange', onVisibilityChange, { once: true });
    if (signer) AuthController.noteSignInSigner(signer);
    navigateTop(toSignerDeepLink(url, signer));
  };

  const onAuthorizeClick = () => open(null);
  const authorizeWith = (signer: SignInSigner) => open(signer);

  return {
    url,
    isLoading,
    isExpired,
    fetchUrl,
    copyAuthUrl,
    isOpeningRing: opening !== null,
    openingSigner: opening === 'other' ? null : opening,
    onAuthorizeClick,
    authorizeWith,
  };
}
