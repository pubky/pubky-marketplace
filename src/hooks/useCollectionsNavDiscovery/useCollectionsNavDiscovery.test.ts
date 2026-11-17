import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFeatureDiscoveryStorageKey, COLLECTIONS_NAV_NEW_BADGE_STORAGE_ID } from '@/config/featureDiscovery';
import { useCollectionsNavDiscovery } from './useCollectionsNavDiscovery';

const mocks = vi.hoisted(() => ({
  currentUserPubky: 'pk:test-user-pubky' as string | null,
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: vi.fn((selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: mocks.currentUserPubky }),
  ),
}));

describe('useCollectionsNavDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.currentUserPubky = 'pk:test-user-pubky';
  });

  it('persists Collections navigation discovery for an authenticated user', () => {
    const { result } = renderHook(() => useCollectionsNavDiscovery());
    act(() => result.current.markCollectionsNavSeen());
    expect(
      window.localStorage.getItem(
        buildFeatureDiscoveryStorageKey('pk:test-user-pubky', COLLECTIONS_NAV_NEW_BADGE_STORAGE_ID),
      ),
    ).toBe('seen');
  });

  it('does not persist discovery for guests', () => {
    mocks.currentUserPubky = null;
    const { result } = renderHook(() => useCollectionsNavDiscovery());
    act(() => result.current.markCollectionsNavSeen());
    expect(window.localStorage.length).toBe(0);
  });

  it('does not rewrite a previously seen discovery', () => {
    window.localStorage.setItem(
      buildFeatureDiscoveryStorageKey('pk:test-user-pubky', COLLECTIONS_NAV_NEW_BADGE_STORAGE_ID),
      'seen',
    );
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useCollectionsNavDiscovery());
    act(() => result.current.markCollectionsNavSeen());
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('persists only the first mark in this mount', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result, rerender } = renderHook(() => useCollectionsNavDiscovery());
    act(() => result.current.markCollectionsNavSeen());
    rerender();
    act(() => result.current.markCollectionsNavSeen());
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });

  it('keeps discovery persistence separate when switching users', () => {
    const { result, rerender } = renderHook(() => useCollectionsNavDiscovery());
    act(() => result.current.markCollectionsNavSeen());
    mocks.currentUserPubky = 'pk:second-user';
    rerender();
    const secondKey = buildFeatureDiscoveryStorageKey('pk:second-user', COLLECTIONS_NAV_NEW_BADGE_STORAGE_ID);
    expect(window.localStorage.getItem(secondKey)).toBeNull();
    act(() => result.current.markCollectionsNavSeen());
    expect(window.localStorage.getItem(secondKey)).toBe('seen');
    expect(window.localStorage.length).toBe(2);
  });
});
