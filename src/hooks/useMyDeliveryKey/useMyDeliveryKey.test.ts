import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SellerDeliveryKeyStatus } from '@/application/commerce/delivery-keys';
import { CommerceController } from '@/controllers/commerce/commerce';
import { toast } from '@/molecules/Toaster/use-toast';
import { useMyDeliveryKey } from './useMyDeliveryKey';

vi.mock('@/config/commerce', () => ({
  getCommerceAdapterMode: () => 'transaction-service',
  isDurableCommerceMode: () => true,
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 's'.repeat(52) }),
}));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMyDeliveryKeyStatus: vi.fn(),
    commitCreateMyDeliveryKey: vi.fn(),
    commitPublishMyDeliveryKey: vi.fn(),
  },
}));
vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

const none: SellerDeliveryKeyStatus = { local: null, publication: 'missing', publishedKeyId: null };
const published: SellerDeliveryKeyStatus = {
  local: { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32), createdAt: '2026-10-12T10:00:00.000Z', current: true },
  publication: 'matches',
  publishedKeyId: 'a'.repeat(32),
};

describe('useMyDeliveryKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockResolvedValue(none);
  });

  it('loads the status and updates it after creating a key', async () => {
    vi.mocked(CommerceController.commitCreateMyDeliveryKey).mockResolvedValue(published);
    const { result } = renderHook(() => useMyDeliveryKey());
    await waitFor(() => expect(result.current.status).toEqual(none));

    let created = false;
    await act(async () => {
      created = await result.current.create();
    });
    expect(created).toBe(true);
    expect(result.current.status).toEqual(published);
  });

  it('reports a failed publish without leaking the error and reloads the status', async () => {
    vi.mocked(CommerceController.commitCreateMyDeliveryKey).mockRejectedValue(new Error('SENTINEL_HOMESERVER'));
    const pending: SellerDeliveryKeyStatus = { ...published, publication: 'missing', publishedKeyId: null };
    const { result } = renderHook(() => useMyDeliveryKey());
    await waitFor(() => expect(result.current.status).toEqual(none));
    vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockResolvedValue(pending);

    let created = true;
    await act(async () => {
      created = await result.current.create();
    });
    expect(created).toBe(false);
    expect(result.current.status).toEqual(pending);
    expect(JSON.stringify(vi.mocked(toast).mock.calls.at(-1))).not.toContain('SENTINEL_HOMESERVER');
  });

  it('flags a status load failure', async () => {
    vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMyDeliveryKey());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
  });
});
