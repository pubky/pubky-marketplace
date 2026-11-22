import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';
import { setStoreSeller } from '@/test-utils/store-mode';
import { useAvatarUrl } from './useAvatarUrl';

// Mock file controller
const mockGetAvatarUrl = vi.fn();
vi.mock('@/controllers/file/file', () => ({
  FileController: {
    getAvatarUrl: (...args: unknown[]) => mockGetAvatarUrl(...args),
  },
}));

const mockUseProfileImageUrl = vi.fn((_fileUri: string | null | undefined): string | null => null);
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', () => ({
  useProfileImageUrl: (fileUri: string | null | undefined) => mockUseProfileImageUrl(fileUri),
}));

describe('useAvatarUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAvatarUrl.mockReturnValue('https://example.com/avatar/test-user.png');
  });

  it('returns avatar URL when user has an image', () => {
    const userDetails = {
      id: 'test-user',
      name: 'Test User',
      image: 'avatar.jpg',
    } as NexusUserDetails;

    const { result } = renderHook(() => useAvatarUrl(userDetails));

    expect(result.current).toBe('https://example.com/avatar/test-user.png');
    expect(mockGetAvatarUrl).toHaveBeenCalledWith('test-user', undefined);
    expect(mockUseProfileImageUrl).toHaveBeenCalledWith(null);
  });

  it('returns undefined when user has no image', () => {
    const userDetails = {
      id: 'test-user',
      name: 'Test User',
      image: null,
    } as NexusUserDetails;

    const { result } = renderHook(() => useAvatarUrl(userDetails));

    expect(result.current).toBeUndefined();
    expect(mockGetAvatarUrl).not.toHaveBeenCalled();
  });

  it('returns undefined when user image is null', () => {
    const userDetails = {
      id: 'test-user',
      name: 'Test User',
      image: null,
    } as NexusUserDetails;

    const { result } = renderHook(() => useAvatarUrl(userDetails));

    expect(result.current).toBeUndefined();
    expect(mockGetAvatarUrl).not.toHaveBeenCalled();
  });

  it('returns undefined when userDetails is null', () => {
    const { result } = renderHook(() => useAvatarUrl(null));

    expect(result.current).toBeUndefined();
    expect(mockGetAvatarUrl).not.toHaveBeenCalled();
  });

  it('returns undefined when userDetails is undefined', () => {
    const { result } = renderHook(() => useAvatarUrl(undefined));

    expect(result.current).toBeUndefined();
    expect(mockGetAvatarUrl).not.toHaveBeenCalled();
  });

  it('memoizes avatar URL when userDetails object reference stays the same', () => {
    const userDetails = {
      id: 'test-user',
      name: 'Test User',
      image: 'avatar.jpg',
    } as NexusUserDetails;

    const { result, rerender } = renderHook(() => useAvatarUrl(userDetails));

    const firstResult = result.current;

    // Rerender with same object reference
    rerender();

    // Should return the same URL (memoized)
    expect(result.current).toBe(firstResult);
    // getAvatarUrl should only be called once (on first render)
    expect(mockGetAvatarUrl).toHaveBeenCalledTimes(1);
  });

  it('recomputes avatar URL when user id changes', () => {
    mockGetAvatarUrl.mockImplementation((pubky: string) => `https://example.com/avatar/${pubky}.png`);

    const userDetails1 = {
      id: 'user-1',
      name: 'User 1',
      image: 'avatar1.jpg',
    } as NexusUserDetails;

    const { result, rerender } = renderHook(({ userDetails }) => useAvatarUrl(userDetails), {
      initialProps: { userDetails: userDetails1 },
    });

    expect(result.current).toBe('https://example.com/avatar/user-1.png');

    const userDetails2 = {
      id: 'user-2',
      name: 'User 2',
      image: 'avatar2.jpg',
    } as NexusUserDetails;

    rerender({ userDetails: userDetails2 });

    expect(result.current).toBe('https://example.com/avatar/user-2.png');
    expect(mockGetAvatarUrl).toHaveBeenCalledTimes(2);
    expect(mockGetAvatarUrl).toHaveBeenCalledWith('user-1', undefined);
    expect(mockGetAvatarUrl).toHaveBeenCalledWith('user-2', undefined);
  });

  it('recomputes avatar URL when image changes from empty to present', () => {
    const userDetails1 = {
      id: 'test-user',
      name: 'Test User',
      image: null,
    } as NexusUserDetails;

    const { result, rerender } = renderHook(({ userDetails }) => useAvatarUrl(userDetails), {
      initialProps: { userDetails: userDetails1 },
    });

    expect(result.current).toBeUndefined();

    const userDetails2 = {
      id: 'test-user',
      name: 'Test User',
      image: 'avatar.jpg',
    } as NexusUserDetails;

    rerender({ userDetails: userDetails2 });

    expect(result.current).toBe('https://example.com/avatar/test-user.png');
    expect(mockGetAvatarUrl).toHaveBeenCalledTimes(1);
  });

  it('passes the cache-busting version to the CDN URL', () => {
    const userDetails = { id: 'test-user', name: 'Test User', image: 'avatar.jpg' } as NexusUserDetails;

    renderHook(() => useAvatarUrl(userDetails, 1234));

    expect(mockGetAvatarUrl).toHaveBeenCalledWith('test-user', 1234);
  });

  describe('in a store', () => {
    const image = `pubky://${'y'.repeat(52)}/pub/pubky.app/files/0034A0X7NJ52G`;

    beforeEach(() => setStoreSeller('ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u'));
    afterEach(() => setStoreSeller(undefined));

    it("resolves the profile's image record on the homeserver and never builds a CDN URL", () => {
      mockUseProfileImageUrl.mockImplementation((fileUri) => (fileUri === image ? 'blob:avatar' : null));
      const userDetails = { id: 'test-user', name: 'Test User', image } as NexusUserDetails;

      const { result } = renderHook(() => useAvatarUrl(userDetails, 1234));

      expect(result.current).toBe('blob:avatar');
      expect(mockGetAvatarUrl).not.toHaveBeenCalled();
    });

    it('returns undefined until the image resolves and for no image', () => {
      mockUseProfileImageUrl.mockReturnValue(null);

      expect(
        renderHook(() => useAvatarUrl({ id: 'u', name: 'U', image } as NexusUserDetails)).result.current,
      ).toBeUndefined();
      expect(renderHook(() => useAvatarUrl(null)).result.current).toBeUndefined();
      expect(mockGetAvatarUrl).not.toHaveBeenCalled();
    });
  });
});
