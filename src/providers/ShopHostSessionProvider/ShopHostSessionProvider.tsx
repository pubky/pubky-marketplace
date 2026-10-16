'use client';

import { createContext, type ReactNode, Suspense, useContext, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isDynamicPublicRoute, PUBLIC_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Spinner } from '@/atoms/Spinner/Spinner';
import { useShopHostSession } from '@/hooks/useShopHostSession/useShopHostSession';
import { publishShopHostPath, requestShopHostAction } from '@/libs/shop-session/bridge';

const ShopHostContext = createContext(false);
export function useIsShopHosted(): boolean {
  return useContext(ShopHostContext);
}

function ShopHostNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    publishShopHostPath();
    const publish = () => publishShopHostPath();
    window.addEventListener('hashchange', publish);
    return () => window.removeEventListener('hashchange', publish);
  }, [pathname, search]);
  return null;
}

export function ShopHostSessionProvider({ children }: { children: ReactNode }) {
  const { configured, hosted, status, hasHostIdentity, retry } = useShopHostSession();
  const pathname = usePathname();
  const publicRoute = PUBLIC_ROUTES.includes(pathname) || isDynamicPublicRoute(pathname);
  const pending = !configured || (hosted && (status === 'connecting' || status === 'restoring'));
  if (pending)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
        <span className="sr-only">Restoring your session</span>
      </div>
    );
  if (hosted && (status === 'temporary-error' || status === 'reauth-required' || status === 'capabilities-required')) {
    return (
      <ShopHostContext.Provider value={true}>
        <Suspense fallback={null}>
          <ShopHostNavigation />
        </Suspense>
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6" role="status">
          <p>
            {status === 'capabilities-required'
              ? 'Approve Shop access in Pubky App to continue.'
              : status === 'reauth-required'
                ? 'Sign in to Pubky App again to continue.'
                : hasHostIdentity
                  ? 'Your Pubky App session could not be restored. Your saved session has been kept.'
                  : 'Shop is temporarily unavailable. Please try again.'}
          </p>
          <Button
            onClick={
              status === 'capabilities-required'
                ? () => requestShopHostAction('request-capabilities')
                : status === 'reauth-required'
                  ? () => requestShopHostAction('request-login')
                  : retry
            }
          >
            {status === 'temporary-error' ? 'Try again' : 'Continue in Pubky App'}
          </Button>
        </div>
        {publicRoute && children}
      </ShopHostContext.Provider>
    );
  }
  return (
    <ShopHostContext.Provider value={hosted}>
      {hosted && (
        <Suspense fallback={null}>
          <ShopHostNavigation />
        </Suspense>
      )}
      {children}
    </ShopHostContext.Provider>
  );
}
