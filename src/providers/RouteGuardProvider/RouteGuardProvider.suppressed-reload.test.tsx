import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStatus } from '@/hooks/useAuthStatus/useAuthStatus';
import { resetFragmentSessionExportCache } from '@/libs/vibe-session/fragment';
import { useAuthStore } from '@/stores/auth/auth.store';
import { RouteGuardProvider } from './RouteGuardProvider';

const mocks = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  subscribeCrossTabSignOut: vi.fn(() => () => {}),
  settlePendingGrantKeyCleanup: vi.fn().mockResolvedValue(true),
  restorePersistedSession: vi.fn().mockResolvedValue({ status: 'signed-out' }),
  pathname: '/home',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.mockRouterPush, refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
}));

vi.mock('@/app/routes', () => ({
  PUBLIC_ROUTES: ['/landing'],
  isDynamicPublicRoute: () => false,
  matchesAllowedRoute: (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`),
}));

vi.mock('@/providers/RouteGuardProvider/RouteGuardProvider.constants', () => ({
  ROUTE_ACCESS_MAP: {
    AUTHENTICATED: { allowedRoutes: ['/feed'], redirectTo: '/feed' },
    UNAUTHENTICATED: { allowedRoutes: ['/login', '/home'], redirectTo: '/login' },
    NEEDS_PROFILE_CREATION: { allowedRoutes: ['/create-profile'], redirectTo: '/create-profile' },
  },
}));

vi.mock('@/atoms/Spinner/Spinner', () => ({
  Spinner: (props: Record<string, unknown>) => <div data-testid="spinner" {...props} />,
}));

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast');

vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: () => ({ hasHydrated: true }),
}));

vi.mock('@/stores/migration/migration.store', () => ({
  useMigrationStore: Object.assign(
    (selector: (state: { wasDbReset: boolean }) => unknown) => selector({ wasDbReset: false }),
    {
      getState: () => ({ reset: vi.fn(), wasDbReset: false }),
    },
  ),
}));

vi.mock('@/controllers/auth/auth', () => ({
  AuthController: {
    restorePersistedSession: mocks.restorePersistedSession,
    subscribeCrossTabSignOut: mocks.subscribeCrossTabSignOut,
    settlePendingGrantKeyCleanup: mocks.settlePendingGrantKeyCleanup,
  },
}));

describe('RouteGuardProvider — signed-out reload uses real useAuthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    resetFragmentSessionExportCache();
    useAuthStore.getState().reset();
    useAuthStore.getState().setHasHydrated(true);
    useAuthStore.getState().setIsRestoringSession(false);
    mocks.pathname = '/home';
    mocks.restorePersistedSession.mockResolvedValue({ status: 'signed-out' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not spin after signed-out rehydration when useAuthStatus is real', async () => {
    useAuthStore.getState().setHasHydrated(false);
    useAuthStore.getState().setIsRestoringSession(false);

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().hasHydrated).toBe(true);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().sessionExport).toBeNull();

    const { result } = renderHook(() => useAuthStatus());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('UNAUTHENTICATED');

    render(
      <RouteGuardProvider>
        <div>Explore Content</div>
      </RouteGuardProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.restorePersistedSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByText('Explore Content')).toBeInTheDocument();
    expect(mocks.mockRouterPush).not.toHaveBeenCalled();
  });

  it('clears a stuck isRestoringSession when the predicate reads false after hydration', async () => {
    // The persisted credentials disappeared before the guard ran. A stale
    // restore flag must not leave the signed-out user behind a spinner.
    useAuthStore.getState().setIsRestoringSession(true);

    render(
      <RouteGuardProvider>
        <div>Explore Content</div>
      </RouteGuardProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.restorePersistedSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByText('Explore Content')).toBeInTheDocument();
  });
});
