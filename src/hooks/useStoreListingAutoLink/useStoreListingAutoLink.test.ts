import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { bareHttpFailure } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { asOpaque } from '@/test-utils/type-assertions';
import { useStoreListingAutoLink } from './useStoreListingAutoLink';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { commitAutoLinkAcrossStores: vi.fn() },
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getListingsBySeller: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

describe('useStoreListingAutoLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    vi.mocked(CommerceController.getListingsBySeller).mockResolvedValue(
      asOpaque<Awaited<ReturnType<typeof CommerceController.getListingsBySeller>>>([
        { listing_id: 'scarf', record: createCommerceListingFixture() },
      ]),
    );
  });

  it('links new listings across the stores and says what it linked and resent', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkAcrossStores).mockResolvedValue({
      linked: 2,
      resent: 1,
      failedStores: [],
    });
    const { result } = renderHook(() => useStoreListingAutoLink());
    await act(async () => {
      await result.current.run();
    });
    expect(ConnectorsController.commitAutoLinkAcrossStores).toHaveBeenCalledWith([
      expect.objectContaining({ listingId: 'scarf' }),
    ]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '2 listings linked to your store',
        description: expect.stringContaining('1 order sent again.'),
      }),
    );
  });

  it('names a store it could not check', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkAcrossStores).mockResolvedValue({
      linked: 0,
      resent: 0,
      failedStores: [connectionFixture({ domain: 'down.myshopify.com', status: 'connected', scopes: [] })],
    });
    const { result } = renderHook(() => useStoreListingAutoLink());
    await act(async () => {
      await result.current.run();
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning', description: expect.stringContaining('down.myshopify.com') }),
    );
  });

  it('is quiet on a server without store connections and outside the live marketplace', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkAcrossStores).mockRejectedValue(bareHttpFailure(404));
    const { result } = renderHook(() => useStoreListingAutoLink());
    await act(async () => {
      await result.current.run();
    });
    expect(toast).not.toHaveBeenCalled();

    mode.value = 'sandbox';
    const sandbox = renderHook(() => useStoreListingAutoLink());
    await act(async () => {
      await sandbox.result.current.run();
    });
    expect(ConnectorsController.commitAutoLinkAcrossStores).toHaveBeenCalledTimes(1);
  });
});
