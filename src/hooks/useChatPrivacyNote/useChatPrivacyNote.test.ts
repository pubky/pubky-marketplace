import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFeatureDiscoveryStorageKey, CHAT_PRIVACY_NOTE_STORAGE_ID } from '@/config/featureDiscovery';
import { useChatPrivacyNote } from './useChatPrivacyNote';

const mocks = vi.hoisted(() => ({
  currentUserPubky: 'pk:test-user-pubky' as string | null,
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: vi.fn((selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: mocks.currentUserPubky }),
  ),
}));

const key = () => buildFeatureDiscoveryStorageKey('pk:test-user-pubky', CHAT_PRIVACY_NOTE_STORAGE_ID);

describe('useChatPrivacyNote', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.currentUserPubky = 'pk:test-user-pubky';
  });

  it('shows the note to a signed-in account that has not dismissed it', async () => {
    const { result } = renderHook(() => useChatPrivacyNote());
    await waitFor(() => expect(result.current.showNote).toBe(true));
  });

  it('hides the note once the account dismissed it, across renders', async () => {
    window.localStorage.setItem(key(), 'dismissed');
    const { result } = renderHook(() => useChatPrivacyNote());
    await waitFor(() => expect(result.current.showNote).toBe(false));
  });

  it('persists a dismissal per account', async () => {
    const { result } = renderHook(() => useChatPrivacyNote());
    await waitFor(() => expect(result.current.showNote).toBe(true));
    act(() => result.current.dismissNote());
    expect(window.localStorage.getItem(key())).toBe('dismissed');
    expect(result.current.showNote).toBe(false);
  });

  it('never shows the note to a signed-out viewer', async () => {
    mocks.currentUserPubky = null;
    const { result } = renderHook(() => useChatPrivacyNote());
    await waitFor(() => expect(result.current.showNote).toBe(false));
    act(() => result.current.dismissNote());
    expect(window.localStorage.length).toBe(0);
  });
});
