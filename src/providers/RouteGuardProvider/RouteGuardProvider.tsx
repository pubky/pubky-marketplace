'use client';

import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  APP_ROUTES,
  getMarketplaceHomeRoute,
  isDynamicPublicRoute,
  matchesAllowedRoute,
  PUBLIC_ROUTES,
  ROOT_ROUTES,
} from '@/app/routes';
import { isStoreSellerViewerRoute } from '@/app/store-route-policy';
import { Spinner } from '@/atoms/Spinner/Spinner';
import { getStoreState } from '@/config/store-mode';
import { AuthController } from '@/controllers/auth/auth';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAuthStatus } from '@/hooks/useAuthStatus/useAuthStatus';
import { AuthStatus } from '@/hooks/useAuthStatus/useAuthStatus.types';
import { TimeoutErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { getWrongEnvironmentHomeserverMessage, isWrongEnvironmentHomeserverError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { shouldAttemptSessionRestore } from '@/libs/vibe-session/should-restore';
import { toast } from '@/molecules/Toaster/toast';
import { ROUTE_ACCESS_MAP } from '@/providers/RouteGuardProvider/RouteGuardProvider.constants';
import {
  consumeRouteGuardReturnTo,
  isRouteGuardReturnToAllowed,
  routeGuardReturnToPathname,
  routeGuardReturnToWithSearch,
  storeRouteGuardReturnTo,
} from '@/providers/RouteGuardProvider/RouteGuardProvider.returnPath';
import { useIsShopHosted } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useMigrationStore } from '@/stores/migration/migration.store';
import { NotFound } from '@/templates/Public/NotFound/NotFound';

// Migration resync timeout in milliseconds
const MIGRATION_RESYNC_TIMEOUT_MS = 10_000;

/**
 * The guarded path with the query it was opened with. `usePathname` omits the query, so
 * it comes from the browser URL and is ignored when that URL is not the guarded path.
 */
function guardedLocation(pathname: string): string {
  if (typeof window === 'undefined' || !window.location.pathname.endsWith(pathname)) return pathname;
  return routeGuardReturnToWithSearch(pathname, window.location.search);
}

interface RouteGuardProviderProps {
  children: ReactNode;
}

/**
 * RouteGuardProvider protects routes based on user authentication status.
 *
 * This provider:
 * - Checks if the current route is accessible for the user's auth status
 * - Redirects unauthorized users to appropriate default routes
 * - Shows loading states while determining access permissions
 * - Allows public routes to be accessed by anyone
 * - Allows dynamic public routes (/post/[x]/[y], /profile/[pubky]) without auth
 *
 * Route access is configured via ROUTE_ACCESS_MAP which maps:
 * - UNAUTHENTICATED users to signin/explore routes
 * - AUTHENTICATED users to app routes (feed, profile, etc.)
 * - NEEDS_PROFILE_CREATION users to profile creation route
 */
export function RouteGuardProvider({ children }: RouteGuardProviderProps) {
  const hosted = useIsShopHosted();
  const router = useRouter();
  const pathname = usePathname();
  const { status, isLoading } = useAuthStatus();
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const session = useAuthStore((state) => state.session);
  const sessionExport = useAuthStore((state) => state.sessionExport);
  const grantSessionRecordId = useAuthStore((state) => state.grantSessionRecordId);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const wasDbReset = useMigrationStore((state) => state.wasDbReset);
  const storeState = getStoreState();
  const isMinimalStoreDocument =
    (storeState.kind === 'unclaimed' && pathname === ROOT_ROUTES) ||
    (storeState.kind === 'unavailable' && pathname === APP_ROUTES.STORE_UNAVAILABLE);

  // Prevents running resync more than once at a time (ex: React Strict Mode and effect re-fires mid-resync)
  const isMigrationResyncRunningRef = useRef(false);
  const pendingReturnToNavigationRef = useRef<string | null>(null);
  // Identity-change cleanup flips sessionExport while Controller finalization is
  // still running; skip so a second restore cannot race the first init.
  const isSessionRestoreInFlightRef = useRef(false);

  // Another tab signed out: a grant session held in this tab lets go too.
  useEffect(() => (hosted ? undefined : AuthController.subscribeCrossTabSignOut()), [hosted]);

  // Grant keys a failed save left behind are removed on the next load.
  useEffect(() => {
    if (hosted || !hasHydrated) return;
    void AuthController.settlePendingGrantKeyCleanup();
  }, [hasHydrated, hosted]);

  // Attempt to restore an existing session snapshot on fresh loads.
  useEffect(() => {
    if (hosted || !hasHydrated) return;
    if (session) return;
    if (isSessionRestoreInFlightRef.current) return;
    // Shared with auth-store rehydrate so `isRestoringSession` is only set when
    // this effect will actually run restore (persist, or consumer + not suppressed
    // / pending `#s=`). After logout, suppression + empty persist skips both.
    if (!grantSessionRecordId && !shouldAttemptSessionRestore(sessionExport)) {
      // Rehydrate set isRestoringSession when the predicate read true; if the
      // situation changed before this effect ran (e.g. logout suppression
      // landed in between), no restore will run - clear the flag so it cannot
      // stick and strand useAuthStatus in its loading branch.
      if (isRestoringSession) {
        useAuthStore.getState().setIsRestoringSession(false);
      }
      return;
    }
    isSessionRestoreInFlightRef.current = true;
    AuthController.restorePersistedSession()
      .catch((error) => {
        if (isWrongEnvironmentHomeserverError(error)) {
          toast({
            variant: 'error',
            description: getWrongEnvironmentHomeserverMessage(),
          });
          return;
        }
        Logger.error('[RouteGuardProvider] Failed to restore persisted session', { error });
      })
      .finally(() => {
        isSessionRestoreInFlightRef.current = false;
      });
  }, [hasHydrated, session, sessionExport, grantSessionRecordId, isRestoringSession, hosted]);

  // Recover the private Shop watchlist after DB recreation. Catalog and account views refresh on demand.
  // TODO: Consider using BroadcastChannel to notify other browser tabs when DB was recreated / resync completed
  useEffect(() => {
    if (!wasDbReset) return; // No need to resync if the DB was NOT reset
    if (!hasHydrated) return; // No need to resync if the app has NOT hydrated
    if (isMigrationResyncRunningRef.current) return; // No need to resync if the resync is ALREADY running
    if (isRestoringSession || isLoading) return;
    if (!currentUserPubky || !session) {
      // Guests have no private watchlist to recover.
      useMigrationStore.getState().reset();
      return;
    }

    isMigrationResyncRunningRef.current = true;

    const runResync = async () => {
      const startedAt = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        // Bound how long we wait for the post-migration resync.
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                Err.timeout(TimeoutErrorCode.REQUEST_TIMEOUT, 'DB re-sync timed out', {
                  service: ErrorService.Local,
                  operation: 'migrationResync',
                }),
              ),
            MIGRATION_RESYNC_TIMEOUT_MS,
          );
        });
        // Unblock the app when either resync finishes or the timeout fires.
        await Promise.race([CommerceController.syncWatchlist(), timeoutPromise]);
      } catch (error) {
        Logger.warn('Migration re-sync degraded', {
          error,
          pubky: currentUserPubky,
          durationMs: Date.now() - startedAt,
        });
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        useMigrationStore.getState().reset();
        isMigrationResyncRunningRef.current = false;
      }
    };

    runResync();
  }, [wasDbReset, hasHydrated, currentUserPubky, session, isRestoringSession, isLoading]);

  useEffect(() => {
    if (status !== AuthStatus.AUTHENTICATED) return;
    if (isLoading) return;

    const routeAccess = ROUTE_ACCESS_MAP[status];
    const returnTo = consumeRouteGuardReturnTo(routeAccess.allowedRoutes);
    if (!returnTo || returnTo === pathname || returnTo === guardedLocation(pathname)) return;

    pendingReturnToNavigationRef.current = returnTo;
    router.push(returnTo);
  }, [status, isLoading, pathname, router]);

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname) || isDynamicPublicRoute(pathname);
  const isRouteAccessible = useMemo(() => {
    if (isMinimalStoreDocument) return true;
    if (isPublicRoute) return true;

    // Wait for authentication status to be determined before allowing access to protected routes
    if (isLoading) return false;

    // Get the allowed routes for the current authentication status
    const routeAccess = ROUTE_ACCESS_MAP[status];

    // Explore routes match exactly for guests only; authenticated users keep prefix access.
    const restrictExploreSubRoutes = status === AuthStatus.UNAUTHENTICATED;

    return routeAccess.allowedRoutes.some((route) =>
      matchesAllowedRoute(pathname, route, { restrictExploreSubRoutes }),
    );
  }, [isLoading, isPublicRoute, pathname, status, isMinimalStoreDocument]);

  // Handle automatic redirects when user tries to access unauthorized routes
  useEffect(() => {
    if (
      pendingReturnToNavigationRef.current &&
      (pathname === routeGuardReturnToPathname(pendingReturnToNavigationRef.current) || isRouteAccessible)
    ) {
      pendingReturnToNavigationRef.current = null;
    }

    if (isPublicRoute) return;

    // Wait for authentication status to be determined for protected routes
    if (isLoading) return;

    // No redirect needed if user has access to current route
    if (isRouteAccessible) return;

    if (pendingReturnToNavigationRef.current) return;

    // Redirect user to the appropriate default route for their authentication status
    const routeAccess = ROUTE_ACCESS_MAP[status];
    const authenticatedRouteAccess = ROUTE_ACCESS_MAP[AuthStatus.AUTHENTICATED];
    const isMarketplaceDeepLink =
      pathname === APP_ROUTES.MARKETPLACE || pathname.startsWith(`${APP_ROUTES.MARKETPLACE}/`);
    const shouldOpenMarketplaceSignIn =
      status === AuthStatus.UNAUTHENTICATED &&
      isMarketplaceDeepLink &&
      isRouteGuardReturnToAllowed(pathname, authenticatedRouteAccess.allowedRoutes);
    const redirectTo = shouldOpenMarketplaceSignIn ? getMarketplaceHomeRoute() : routeAccess.redirectTo;

    // Runtime validation: ensure redirect target is actually in allowed routes
    if (redirectTo && !routeAccess.allowedRoutes.some((route) => matchesAllowedRoute(redirectTo, route))) {
      Logger.error(
        `RouteGuard configuration error: redirectTo "${redirectTo}" is not in allowedRoutes for status "${status}"`,
      );
      return;
    }

    // Only redirect if we have a target and we're not already there
    if (redirectTo && pathname !== redirectTo) {
      if (shouldOpenMarketplaceSignIn) {
        storeRouteGuardReturnTo(guardedLocation(pathname));
        useAuthStore.getState().setShowSignInDialog(true);
      } else if (
        (status === AuthStatus.UNAUTHENTICATED || status === AuthStatus.NEEDS_PROFILE_CREATION) &&
        isRouteGuardReturnToAllowed(pathname, authenticatedRouteAccess.allowedRoutes)
      ) {
        storeRouteGuardReturnTo(guardedLocation(pathname));
        if (status === AuthStatus.UNAUTHENTICATED) {
          toast({ variant: 'info', description: 'Sign in to open that page.' });
        }
      }
      router.push(redirectTo);
    }
  }, [status, pathname, router, isLoading, isRouteAccessible, isPublicRoute]);

  // A store's selling tools exist only for the store seller; the proxy cannot see who is signed in.
  if (
    storeState.kind === 'claimed' &&
    status === AuthStatus.AUTHENTICATED &&
    !isLoading &&
    currentUserPubky !== storeState.seller &&
    isStoreSellerViewerRoute(pathname)
  ) {
    return <NotFound />;
  }

  // Show loading spinner while:
  // 1. Authentication status is being determined (isLoading = true)
  // 2. Route access check has completed but user doesn't have access (will trigger redirect)
  // 3. A protected route is waiting for private watchlist recovery after DB recreation.
  if (!isRouteAccessible || (wasDbReset && !isPublicRoute)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Spinner className="mx-auto" />
          <p className="mt-2 text-muted-foreground">{isLoading || wasDbReset ? 'Loading...' : 'Redirecting...'}</p>
        </div>
      </div>
    );
  }

  // Render the protected content only when user has confirmed access
  return <>{children}</>;
}
