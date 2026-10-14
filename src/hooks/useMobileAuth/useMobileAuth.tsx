'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isIosUserAgent, toBitkitIosSignInUrl } from '@/libs/navigation/bitkit-ios-url';
import { navigateTop } from '@/libs/navigation/navigate-top';
import { useAuthUrl } from '../useAuthUrl/useAuthUrl';
import type { UseAuthUrlOptions } from '../useAuthUrl/useAuthUrl.types';

type UseMobileAuthReturn = {
  url: string;
  isLoading: boolean;
  isExpired: boolean;
  fetchUrl: () => Promise<void>;
  copyAuthUrl: () => Promise<void>;
  isOpeningRing: boolean;
  onAuthorizeClick: () => void;
};

/**
 * Manages mobile auth flow via deeplink navigation.
 * Resets the opening state when the page becomes hidden (app opened successfully).
 * On iOS a grant sign-in opens Bitkit's own `bitkit://` link: Bitkit iOS leaves
 * `pubkyauth://` to Pubky Ring. The QR and copied link stay `pubkyauth://`.
 */
export function useMobileAuth(options: UseAuthUrlOptions = {}): UseMobileAuthReturn {
  const { url, isLoading, isExpired, fetchUrl, copyAuthUrl } = useAuthUrl(options);
  const [isOpeningRing, setIsOpeningRing] = useState(false);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isLoading) {
      setIsOpeningRing(false);
    }
  }, [isLoading]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const onAuthorizeClick = () => {
    if (isLoading) return;

    if (!url) {
      cleanup();
      setIsOpeningRing(false);
      void fetchUrl();
      return;
    }

    cleanup();
    setIsOpeningRing(true);

    const onVisibilityChange = () => {
      if (document.hidden) {
        cleanup();
        setIsOpeningRing(false);
      }
    };
    visibilityHandlerRef.current = onVisibilityChange;

    document.addEventListener('visibilitychange', onVisibilityChange, { once: true });
    navigateTop(options.type === 'grant' && isIosUserAgent() ? toBitkitIosSignInUrl(url) : url);
  };

  return {
    url,
    isLoading,
    isExpired,
    fetchUrl,
    copyAuthUrl,
    isOpeningRing,
    onAuthorizeClick,
  };
}
