import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFeatureDiscoveryStorageKey, DELIVERY_KEY_CUSTODY_NOTICE_STORAGE_ID } from '@/config/featureDiscovery';
import { clearPubkyLocalStorage } from '@/libs/auth/clear-pubky-local-storage';
import { useDeliveryKeyCustodyNotice } from './useDeliveryKeyCustodyNotice';

const SELLER = 's'.repeat(52);
const OTHER_SELLER = 'o'.repeat(52);

const mocks = vi.hoisted(() => ({ currentUserPubky: null as string | null }));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: vi.fn((selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: mocks.currentUserPubky }),
  ),
}));

const key = (pubky: string) => buildFeatureDiscoveryStorageKey(pubky, DELIVERY_KEY_CUSTODY_NOTICE_STORAGE_ID);

describe('useDeliveryKeyCustodyNotice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.currentUserPubky = SELLER;
  });

  it('shows the notice until the seller dismisses it, and keeps it dismissed for that seller only', async () => {
    const { result, unmount } = renderHook(() => useDeliveryKeyCustodyNotice());
    await waitFor(() => expect(result.current.showNotice).toBe(true));
    act(() => result.current.dismissNotice());
    expect(result.current.showNotice).toBe(false);
    expect(window.localStorage.getItem(key(SELLER))).toBe('dismissed');
    unmount();

    const again = renderHook(() => useDeliveryKeyCustodyNotice());
    await waitFor(() => expect(again.result.current.showNotice).toBe(false));
    again.unmount();

    mocks.currentUserPubky = OTHER_SELLER;
    const other = renderHook(() => useDeliveryKeyCustodyNotice());
    await waitFor(() => expect(other.result.current.showNotice).toBe(true));
  });

  it("is forgotten with the rest of the account's entries when it signs out of this browser", async () => {
    window.localStorage.setItem(key(SELLER), 'dismissed');
    expect(clearPubkyLocalStorage(SELLER)).toContain(key(SELLER));

    const { result } = renderHook(() => useDeliveryKeyCustodyNotice());
    await waitFor(() => expect(result.current.showNotice).toBe(true));
  });

  it('never shows the notice signed out, and stores nothing', async () => {
    mocks.currentUserPubky = null;
    const { result } = renderHook(() => useDeliveryKeyCustodyNotice());
    await waitFor(() => expect(result.current.showNotice).toBe(false));
    act(() => result.current.dismissNotice());
    expect(window.localStorage.length).toBe(0);
  });
});
