import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { ConnectorSync } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { recordedSync } from '@/test-utils/connector-changes';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { useListingStoreSync } from './useListingStoreSync';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string, sync: true }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value, getStoreSyncEnabled: () => mode.sync };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    fetchConnections: vi.fn(),
    fetchMappings: vi.fn(),
    fetchSync: vi.fn(),
    commitListingSync: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

const shopify = connectionFixture({ id: 'c1', provider: 'shopify', domain: 'demo.myshopify.com', status: 'connected' });
const woo = connectionFixture({ id: 'c0', provider: 'woocommerce', domain: 'shop.example', status: 'connected' });
const mapping = (listingId: string) => ({
  listingId,
  variantId: 'v1',
  providerProductId: 'gid://shopify/Product/9001',
  providerVariantId: 'gid://shopify/ProductVariant/50001',
});

describe('useListingStoreSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    mode.sync = true;
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([woo, shopify]);
    vi.mocked(ConnectorsController.fetchMappings).mockImplementation(async (id) =>
      id === 'c1' ? [mapping('boots_01'), mapping('mug_01')] : [],
    );
    vi.mocked(ConnectorsController.fetchSync).mockResolvedValue(recordedSync());
  });

  it('says a linked listing follows the store for every group, with the store product to edit', async () => {
    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    await waitFor(() => expect(result.current.sync).not.toBeNull());

    expect(result.current.sync).toEqual({
      connectionId: 'c1',
      domain: 'demo.myshopify.com',
      editInStoreUrl: 'https://demo.myshopify.com/admin/products/9001',
      groups: {
        content: { follows: true, overridden: false },
        price: { follows: true, overridden: false },
        variants: { follows: true, overridden: false },
      },
    });
  });

  it("reads the listing's own override: the recorded mug does not follow the store for price", async () => {
    const { result } = renderHook(() => useListingStoreSync('mug_01'));

    await waitFor(() => expect(result.current.sync).not.toBeNull());

    expect(result.current.sync?.groups.price).toEqual({ follows: false, overridden: true });
    expect(result.current.sync?.groups.content).toEqual({ follows: true, overridden: false });
  });

  it('has nothing for a listing no store is linked to', async () => {
    const { result } = renderHook(() => useListingStoreSync('unlinked_01'));

    await waitFor(() => expect(ConnectorsController.fetchMappings).toHaveBeenCalled());

    expect(result.current.sync).toBeNull();
    expect(ConnectorsController.fetchSync).not.toHaveBeenCalled();
  });

  it('overrides a group for this listing with the opposite of the connection, and returns it', async () => {
    const overridden: ConnectorSync = {
      ...recordedSync(),
      overrides: [{ listingId: 'boots_01', fieldGroup: 'content', direction: 'off' }],
    };
    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValueOnce(overridden);
    const { result } = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(result.current.sync).not.toBeNull());

    await act(async () => {
      await result.current.toggleOverride('content');
    });

    expect(ConnectorsController.commitListingSync).toHaveBeenLastCalledWith('c1', 'boots_01', { content: 'off' });
    expect(result.current.sync?.groups.content).toEqual({ follows: false, overridden: true });

    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValueOnce(recordedSync());
    await act(async () => {
      await result.current.toggleOverride('content');
    });

    expect(ConnectorsController.commitListingSync).toHaveBeenLastCalledWith('c1', 'boots_01', { content: null });
    expect(result.current.sync?.groups.content).toEqual({ follows: true, overridden: false });
  });

  it('keeps the setting and says so when the service refuses the override', async () => {
    vi.mocked(ConnectorsController.commitListingSync).mockRejectedValue(connectorRefusal('listing_not_linked', 404));
    const { result } = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(result.current.sync).not.toBeNull());

    let ok = true;
    await act(async () => {
      ok = await result.current.toggleOverride('price');
    });

    expect(ok).toBe(false);
    expect(result.current.sync?.groups.price.follows).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('shows nothing when the connections cannot be read', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValue(connectorRefusal('connectors_disabled', 404));

    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    await waitFor(() => expect(ConnectorsController.fetchConnections).toHaveBeenCalled());
    expect(result.current.sync).toBeNull();
  });

  it('does nothing while the store sync switch is off', () => {
    mode.sync = false;

    renderHook(() => useListingStoreSync('boots_01'));

    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
  });

  it('does nothing outside the live marketplace', () => {
    mode.value = 'local';

    renderHook(() => useListingStoreSync('boots_01'));

    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
  });
});
