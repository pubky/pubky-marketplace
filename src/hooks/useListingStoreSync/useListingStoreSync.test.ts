import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { ConnectorSync } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { recordedSync } from '@/test-utils/connector-changes';
import { bareHttpFailure, connectorRefusal } from '@/test-utils/connector-errors';
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

    await waitFor(() => expect(result.current.syncs).toHaveLength(1));

    expect(result.current.syncs[0]).toEqual({
      connectionId: 'c1',
      domain: 'demo.myshopify.com',
      editInStoreUrl: 'https://demo.myshopify.com/admin/products/9001',
      groups: {
        content: { follows: true, overridden: false },
        price: { follows: true, overridden: false },
        variants: { follows: true, overridden: false },
      },
    });
    expect(result.current.follows).toEqual({ content: true, price: true, variants: true });
    expect(result.current.ready).toBe(true);
  });

  it('is not ready until the stores have been asked, so the editor does not save before it knows', async () => {
    let release: (value: ReturnType<typeof connectionFixture>[]) => void = () => {};
    vi.mocked(ConnectorsController.fetchConnections).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    expect(result.current.ready).toBe(false);
    await act(async () => release([shopify]));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("reads the listing's own override: the recorded mug does not follow the store for price", async () => {
    const { result } = renderHook(() => useListingStoreSync('mug_01'));

    await waitFor(() => expect(result.current.syncs).toHaveLength(1));

    expect(result.current.syncs[0]?.groups.price).toEqual({ follows: false, overridden: true });
    expect(result.current.syncs[0]?.groups.content).toEqual({ follows: true, overridden: false });
    expect(result.current.follows).toEqual({ content: true, price: false, variants: true });
  });

  it('has nothing for a listing no store is linked to, and is ready', async () => {
    const { result } = renderHook(() => useListingStoreSync('unlinked_01'));

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.syncs).toEqual([]);
    expect(result.current.follows).toEqual({ content: false, price: false, variants: false });
    expect(ConnectorsController.fetchSync).not.toHaveBeenCalled();
  });

  it('counts a part as followed when any linked store follows it', async () => {
    const second = connectionFixture({
      id: 'c2',
      provider: 'shopify',
      domain: 'other.myshopify.com',
      status: 'connected',
    });
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([shopify, second]);
    vi.mocked(ConnectorsController.fetchMappings).mockResolvedValue([mapping('mug_01')]);
    vi.mocked(ConnectorsController.fetchSync).mockImplementation(async (id) =>
      id === 'c1'
        ? {
            ...recordedSync(),
            groups: recordedSync().groups.map((group) => ({ ...group, direction: 'off' as const })),
            overrides: [],
          }
        : recordedSync(),
    );

    const { result } = renderHook(() => useListingStoreSync('mug_01'));

    await waitFor(() => expect(result.current.syncs).toHaveLength(2));
    expect(result.current.syncs[0]?.groups.content.follows).toBe(false);
    expect(result.current.follows.content).toBe(true);
  });

  it('gives no link to a store page for a host that is not a myshopify.com store', async () => {
    const lookalike = connectionFixture({
      id: 'c1',
      provider: 'shopify',
      domain: 'evil.example.com',
      status: 'connected',
    });
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([lookalike]);

    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    await waitFor(() => expect(result.current.syncs).toHaveLength(1));
    expect(result.current.syncs[0]?.editInStoreUrl).toBeNull();
  });

  it('overrides a group for this listing with the opposite of the connection, and returns it', async () => {
    const overridden: ConnectorSync = {
      ...recordedSync(),
      overrides: [{ listingId: 'boots_01', fieldGroup: 'content', direction: 'off' }],
    };
    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValueOnce(overridden);
    const { result } = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(result.current.syncs).toHaveLength(1));

    let next: Awaited<ReturnType<typeof result.current.toggleOverride>> = null;
    await act(async () => {
      next = await result.current.toggleOverride('c1', 'content');
    });

    expect(ConnectorsController.commitListingSync).toHaveBeenLastCalledWith('c1', 'boots_01', { content: 'off' });
    expect(next).toEqual({ follows: false, overridden: true });
    expect(result.current.syncs[0]?.groups.content).toEqual({ follows: false, overridden: true });
    expect(result.current.follows.content).toBe(false);

    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValueOnce(recordedSync());
    await act(async () => {
      next = await result.current.toggleOverride('c1', 'content');
    });

    expect(ConnectorsController.commitListingSync).toHaveBeenLastCalledWith('c1', 'boots_01', { content: null });
    expect(next).toEqual({ follows: true, overridden: false });
  });

  it('opts a listing in for a group the connection leaves alone', async () => {
    const off: ConnectorSync = {
      ...recordedSync(),
      groups: recordedSync().groups.map((group) => ({ ...group, direction: 'off' as const })),
      overrides: [],
    };
    vi.mocked(ConnectorsController.fetchSync).mockResolvedValue(off);
    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValue({
      ...off,
      overrides: [{ listingId: 'boots_01', fieldGroup: 'price', direction: 'from_store' }],
    });
    const { result } = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(result.current.syncs).toHaveLength(1));
    expect(result.current.follows.price).toBe(false);

    await act(async () => {
      await result.current.toggleOverride('c1', 'price');
    });

    expect(ConnectorsController.commitListingSync).toHaveBeenLastCalledWith('c1', 'boots_01', { price: 'from_store' });
    expect(result.current.follows.price).toBe(true);
  });

  it('keeps the setting and says so when the service refuses the override', async () => {
    vi.mocked(ConnectorsController.commitListingSync).mockRejectedValue(connectorRefusal('listing_not_linked', 404));
    const { result } = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(result.current.syncs).toHaveLength(1));

    let next: Awaited<ReturnType<typeof result.current.toggleOverride>> | undefined;
    await act(async () => {
      next = await result.current.toggleOverride('c1', 'price');
    });

    expect(next).toBeNull();
    expect(result.current.syncs[0]?.groups.price.follows).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('ends ready with nothing followed on a server with no store connections or without a session', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValueOnce(
      connectorRefusal('connectors_disabled', 404),
    );
    const first = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(first.result.current.syncs).toEqual([]);
    expect(first.result.current.failed).toBe(false);

    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValueOnce(
      connectorRefusal('marketplace_session_required', 401),
    );
    const second = renderHook(() => useListingStoreSync('boots_01'));
    await waitFor(() => expect(ConnectorsController.fetchConnections).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
  });

  it('keeps the editor not ready when the lookup fails for any other reason, and asks again on retry', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValueOnce(bareHttpFailure(503));
    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(result.current.syncs).toEqual([]);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.failed).toBe(false);
    expect(result.current.syncs).toHaveLength(1);
  });

  it('does nothing while the store sync switch is off', () => {
    mode.sync = false;

    const { result } = renderHook(() => useListingStoreSync('boots_01'));

    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  it('does nothing outside the live marketplace', () => {
    mode.value = 'local';

    renderHook(() => useListingStoreSync('boots_01'));

    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
  });
});
