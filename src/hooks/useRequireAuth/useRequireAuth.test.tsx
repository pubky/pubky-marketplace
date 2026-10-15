import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequireAuth } from './useRequireAuth';

const host = vi.hoisted(() => ({ request: vi.fn(() => false) }));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: host.request }));
const mockCurrentUserPubky = vi.hoisted(() => ({
  value: null as string | null,
  session: { grant: {} } as { grant: object } | null,
  hasProfile: true,
  isRestoringSession: false,
}));
const mockSetShowSignInDialog = vi.hoisted(() => vi.fn());

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string | null }) => unknown) =>
      selector({ ...mockCurrentUserPubky, currentUserPubky: mockCurrentUserPubky.value }),
    {
      getState: () => ({
        ...mockCurrentUserPubky,
        currentUserPubky: mockCurrentUserPubky.value,
        setShowSignInDialog: mockSetShowSignInDialog,
      }),
    },
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUserPubky.value = null;
  mockCurrentUserPubky.session = { grant: {} };
  mockCurrentUserPubky.hasProfile = true;
  mockCurrentUserPubky.isRestoringSession = false;
  host.request.mockReturnValue(false);
});

describe('useRequireAuth', () => {
  describe('isAuthenticated', () => {
    it('should return false when user is not authenticated', () => {
      mockCurrentUserPubky.value = null;

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should return true when user is authenticated', () => {
      mockCurrentUserPubky.value = 'test-pubky-123';

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  describe('requireAuth', () => {
    it('should execute action and return result when user is authenticated', () => {
      mockCurrentUserPubky.value = 'test-pubky-123';
      const mockAction = vi.fn(() => 'action-result');

      const { result } = renderHook(() => useRequireAuth());

      let returnValue: string | undefined;
      act(() => {
        returnValue = result.current.requireAuth(mockAction);
      });

      expect(mockAction).toHaveBeenCalledTimes(1);
      expect(returnValue).toBe('action-result');
      expect(mockSetShowSignInDialog).not.toHaveBeenCalled();
    });

    it('should open sign in dialog and return undefined when user is not authenticated', () => {
      mockCurrentUserPubky.value = null;
      const mockAction = vi.fn(() => 'action-result');

      const { result } = renderHook(() => useRequireAuth());

      let returnValue: string | undefined;
      act(() => {
        returnValue = result.current.requireAuth(mockAction);
      });

      expect(mockAction).not.toHaveBeenCalled();
      expect(returnValue).toBeUndefined();
      expect(mockSetShowSignInDialog).toHaveBeenCalledWith(true);
    });

    it('should be memoized and not change reference when dependencies stay the same', () => {
      mockCurrentUserPubky.value = 'test-pubky-123';

      const { result, rerender } = renderHook(() => useRequireAuth());
      const firstRequireAuth = result.current.requireAuth;

      rerender();

      expect(result.current.requireAuth).toBe(firstRequireAuth);
    });
  });
});

it('does not treat a retained legacy identity as authority', () => {
  mockCurrentUserPubky.value = 'retained-pubky';
  mockCurrentUserPubky.session = null;
  const action = vi.fn();
  const { result } = renderHook(() => useRequireAuth());
  act(() => result.current.requireAuth(action));
  expect(action).not.toHaveBeenCalled();
  expect(result.current.isAuthenticated).toBe(false);
  expect(mockSetShowSignInDialog).toHaveBeenCalledWith(true);
});

it('requests App-owned sign-in for a hosted action without authority', () => {
  mockCurrentUserPubky.value = 'retained-pubky';
  mockCurrentUserPubky.session = null;
  host.request.mockReturnValue(true);
  mockSetShowSignInDialog.mockClear();
  const { result } = renderHook(() => useRequireAuth());
  act(() => result.current.requireAuth(vi.fn()));
  expect(host.request).toHaveBeenCalledWith('request-login');
  expect(mockSetShowSignInDialog).not.toHaveBeenCalled();
});
