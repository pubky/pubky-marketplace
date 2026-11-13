import type { Session } from '@synonymdev/pubky';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession as buildSession } from '@/test-utils/pubky';
import { useAuthStatus } from './useAuthStatus';

const mockSession = buildSession();

// Mock the stores
const mockAuthStore = {
  session: null as Session | null,
  sessionExport: null as string | null,
  isRestoringSession: false,
  sessionRestoreDeferred: false,
  hasProfile: null as boolean | null,
  hasHydrated: true,
  selectIsAuthenticated: vi.fn(() => false),
  reset: vi.fn(),
  setHasProfile: vi.fn(),
  setSession: vi.fn(),
  setHasHydrated: vi.fn(),
};

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: () => mockAuthStore,
}));

describe('useAuthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock values
    mockAuthStore.session = null;
    mockAuthStore.sessionExport = null;
    mockAuthStore.isRestoringSession = false;
    mockAuthStore.sessionRestoreDeferred = false;
    mockAuthStore.hasProfile = null;
    mockAuthStore.hasHydrated = true;
    mockAuthStore.selectIsAuthenticated = vi.fn(() => false);
  });

  it('should return loading state when auth store not hydrated', () => {
    mockAuthStore.hasHydrated = false;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.status).toBe('UNAUTHENTICATED');
  });

  it('should return not loading when the auth store is hydrated', () => {
    mockAuthStore.hasHydrated = true;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.isLoading).toBe(false);
  });

  it('should return loading state when sessionExport exists but session is null (pending restoration)', () => {
    mockAuthStore.hasHydrated = true;
    mockAuthStore.sessionExport = 'some-exported-session';
    mockAuthStore.session = null;

    const { result } = renderHook(() => useAuthStatus());

    // Should be loading because we have credentials to restore
    expect(result.current.isLoading).toBe(true);
  });

  it('is not loading after a suppressed consumer rehydrate with no sessionExport', () => {
    mockAuthStore.hasHydrated = true;
    mockAuthStore.sessionExport = null;
    mockAuthStore.session = null;
    mockAuthStore.isRestoringSession = false;
    mockAuthStore.hasProfile = null;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('UNAUTHENTICATED');
  });

  it('is not loading and is unauthenticated when persist restore is deferred', () => {
    mockAuthStore.hasHydrated = true;
    mockAuthStore.sessionExport = 'some-exported-session';
    mockAuthStore.session = null;
    mockAuthStore.sessionRestoreDeferred = true;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('UNAUTHENTICATED');
    expect(result.current.isFullyAuthenticated).toBe(false);
    expect(result.current.hasKeypair).toBe(false);
  });

  it('should return UNAUTHENTICATED status when no session and hasProfile is null', () => {
    mockAuthStore.session = null;
    mockAuthStore.hasProfile = null;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.status).toBe('UNAUTHENTICATED');
    expect(result.current.isFullyAuthenticated).toBe(false);
    expect(result.current.hasKeypair).toBe(false);
    expect(result.current.hasProfile).toBe(null);
  });

  it('should return UNAUTHENTICATED status when has session but hasProfile is null (determining)', () => {
    mockAuthStore.session = mockSession;
    mockAuthStore.hasProfile = null; // Still determining profile status

    const { result } = renderHook(() => useAuthStatus());

    // User stays UNAUTHENTICATED while hasProfile is null (allows sign-in progress UI)
    expect(result.current.status).toBe('UNAUTHENTICATED');
    expect(result.current.isFullyAuthenticated).toBe(false);
    expect(result.current.hasKeypair).toBe(true);
    expect(result.current.hasProfile).toBe(null);
  });

  it('should return NEEDS_PROFILE_CREATION status when has session but no profile', () => {
    mockAuthStore.session = mockSession;
    mockAuthStore.hasProfile = false;
    mockAuthStore.selectIsAuthenticated = vi.fn(() => true); // Has session, so authenticated

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.status).toBe('NEEDS_PROFILE_CREATION');
    expect(result.current.isFullyAuthenticated).toBe(false);
    expect(result.current.hasKeypair).toBe(true);
    expect(result.current.hasProfile).toBe(false);
  });

  it('should return AUTHENTICATED status when has profile', () => {
    mockAuthStore.session = mockSession;
    mockAuthStore.hasProfile = true;
    mockAuthStore.selectIsAuthenticated = vi.fn(() => true); // Has session, so authenticated

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.status).toBe('AUTHENTICATED');
    expect(result.current.isFullyAuthenticated).toBe(true);
    expect(result.current.hasKeypair).toBe(true);
    expect(result.current.hasProfile).toBe(true);
  });

  it('should check keypair existence correctly based on session', () => {
    mockAuthStore.session = mockSession;
    mockAuthStore.selectIsAuthenticated = vi.fn(() => true); // Has session, so authenticated

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.hasKeypair).toBe(true);
  });

  it('should handle missing keypair correctly when session is null', () => {
    mockAuthStore.session = null;

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current.hasKeypair).toBe(false);
  });

  describe('Logout Scenario - Hydration Preservation', () => {
    it('should remain not loading after store reset if hydration is preserved', () => {
      // Simulate authenticated state
      mockAuthStore.session = mockSession;
      mockAuthStore.hasProfile = true;

      const { result, rerender } = renderHook(() => useAuthStatus());

      // Initially authenticated and not loading
      expect(result.current.isLoading).toBe(false);
      expect(result.current.status).toBe('AUTHENTICATED');

      // Simulate logout: reset stores but preserve hydration
      mockAuthStore.session = null;
      mockAuthStore.hasProfile = false;
      mockAuthStore.selectIsAuthenticated = vi.fn(() => false); // No session, not authenticated
      // hasHydrated should remain true (this is the fix)

      rerender();

      // After logout: should not be loading and should be unauthenticated
      expect(result.current.isLoading).toBe(false);
      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.hasKeypair).toBe(false);
    });
  });
});
