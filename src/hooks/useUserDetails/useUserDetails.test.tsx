import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTtlUserMs } from '@/config/sync';
import { setStoreSeller } from '@/test-utils/store-mode';
import { useUserDetails } from './useUserDetails';

// Mock direct dependencies
const mockGetDetails = vi.fn();
const mockFetchDetails = vi.fn().mockResolvedValue(undefined);
vi.mock('@/controllers/user/user', () => ({
  UserController: {
    getDetails: (params: { userId: string }) => mockGetDetails(params),
    fetchDetails: (params: { userId: string }) => mockFetchDetails(params),
  },
}));

// Mock dexie-react-hooks (same pattern as usePostDetails.test.tsx)
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (queryFn: () => Promise<unknown>, _deps: unknown[], defaultValue: unknown) => {
    // Execute the query function to trigger it
    queryFn();
    // Return the mock value based on what mockGetDetails returns
    const result = mockGetDetails.mock.results[mockGetDetails.mock.results.length - 1];
    return result?.value ?? defaultValue;
  },
}));

describe('useUserDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetails.mockReturnValue(null);
  });

  it('returns loading state initially when userId is null', () => {
    const { result } = renderHook(() => useUserDetails(null));

    // When userId is null, enabled=false so queryFn is not called,
    // useLiveQuery returns undefined (defaultValue) → isLoading: true
    expect(result.current.isLoading).toBe(true);
  });

  it('returns user details when userId is valid', () => {
    const mockUser = { id: 'test-user', name: 'Test User', bio: 'Test bio' };
    mockGetDetails.mockReturnValue(mockUser);

    const { result } = renderHook(() => useUserDetails('test-user'));

    expect(result.current.userDetails).toEqual(mockUser);
    expect(result.current.isLoading).toBe(false);
  });

  it('calls UserController.getDetails with correct userId', () => {
    const mockUser = { id: 'user-123', name: 'User' };
    mockGetDetails.mockReturnValue(mockUser);

    renderHook(() => useUserDetails('user-123'));

    expect(mockGetDetails).toHaveBeenCalledWith({ userId: 'user-123' });
  });

  it('returns loading state when user is not found (null from DB)', () => {
    // When DB returns null, the mock's ?? operator falls back to defaultValue (undefined)
    // This represents the "loading" state in the hook's perspective
    mockGetDetails.mockReturnValue(null);

    const { result } = renderHook(() => useUserDetails('non-existent-user'));

    // In real usage, Dexie would return null which the hook would receive
    // With our mock, undefined is returned, indicating loading state
    expect(result.current.isLoading).toBe(true);
  });

  it('does not call getDetails when userId is null', () => {
    renderHook(() => useUserDetails(null));

    // enabled=false so queryFn is not called, getDetails is never invoked
    expect(mockGetDetails).not.toHaveBeenCalled();
  });

  it('does not call getDetails when userId is undefined', () => {
    renderHook(() => useUserDetails(undefined));

    // enabled=false so queryFn is not called, getDetails is never invoked
    expect(mockGetDetails).not.toHaveBeenCalled();
  });

  describe('in a store', () => {
    const userAt = (indexedAt: number) => ({ id: 'user-123', name: 'Bob Example', indexed_at: indexedAt });

    afterEach(() => setStoreSeller(undefined));

    it('re-reads a profile older than the user TTL from its homeserver', () => {
      setStoreSeller('s'.repeat(52));
      mockGetDetails.mockReturnValue(userAt(Date.now() - getTtlUserMs() - 1_000));

      const { result } = renderHook(() => useUserDetails('user-123'));

      expect(mockFetchDetails).toHaveBeenCalledWith({ userId: 'user-123' });
      expect(result.current.userDetails?.name).toBe('Bob Example');
    });

    it('keeps a profile read within the user TTL', () => {
      setStoreSeller('s'.repeat(52));
      mockGetDetails.mockReturnValue(userAt(Date.now()));

      renderHook(() => useUserDetails('user-123'));

      expect(mockFetchDetails).not.toHaveBeenCalled();
    });

    it('leaves freshness to the TTL coordinator outside a store', () => {
      mockGetDetails.mockReturnValue(userAt(0));

      renderHook(() => useUserDetails('user-123'));

      expect(mockFetchDetails).not.toHaveBeenCalled();
    });
  });
});
