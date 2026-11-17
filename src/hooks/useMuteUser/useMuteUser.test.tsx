import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMethod } from '@/libs/http/http.types';
import { useMuteUser } from './useMuteUser';

const { mockUseAuthStore, mockCommitMute, mockIsAppError, mockLogger } = vi.hoisted(() => ({
  mockUseAuthStore: vi.fn(),
  mockCommitMute: vi.fn(),
  mockIsAppError: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));
vi.mock('@/controllers/mute/mute', () => ({
  MuteController: {
    commitMute: (...args: unknown[]) => mockCommitMute(...args),
  },
}));

vi.mock('@/libs/logger/logger', () => ({
  Logger: mockLogger,
}));
vi.mock('@/libs/error/error.utils', () => ({
  isAppError: (...args: unknown[]) => mockIsAppError(...args),
}));

describe('useMuteUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAppError.mockReturnValue(false);
    mockUseAuthStore.mockReturnValue({ currentUserPubky: 'current-user' });
  });

  it('does not mute when user is not authenticated', async () => {
    mockUseAuthStore.mockReturnValue({ currentUserPubky: null });

    const { result } = renderHook(() => useMuteUser());

    await act(async () => {
      await result.current.toggleMute('user-1', false);
    });

    expect(mockCommitMute).not.toHaveBeenCalled();
  });

  it('does not mute self', async () => {
    const { result } = renderHook(() => useMuteUser());

    await act(async () => {
      await result.current.toggleMute('current-user', false);
    });

    expect(mockCommitMute).not.toHaveBeenCalled();
  });

  it('calls commitMute with PUT when muting', async () => {
    const { result } = renderHook(() => useMuteUser());

    await act(async () => {
      await result.current.toggleMute('user-1', false);
    });

    expect(mockCommitMute).toHaveBeenCalledWith(HttpMethod.PUT, { muter: 'current-user', mutee: 'user-1' });
  });

  it('calls commitMute with DELETE when unmuting', async () => {
    const { result } = renderHook(() => useMuteUser());

    await act(async () => {
      await result.current.toggleMute('user-1', true);
    });

    expect(mockCommitMute).toHaveBeenCalledWith(HttpMethod.DELETE, { muter: 'current-user', mutee: 'user-1' });
  });

  it('rethrows on failure and clears loading state', async () => {
    const error = new Error('boom');
    mockCommitMute.mockRejectedValue(error);
    mockIsAppError.mockReturnValue(true);

    const { result } = renderHook(() => useMuteUser());

    await act(async () => {
      await expect(result.current.toggleMute('user-1', false)).rejects.toBe(error);
    });

    expect(result.current.isLoading).toBe(false);
  });
});
