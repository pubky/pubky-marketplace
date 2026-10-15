import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { type ConnectorCatalogProduct, connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { useConnectorCatalog } from './useConnectorCatalog';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    fetchSelection: vi.fn(),
    fetchMappings: vi.fn(),
    fetchCatalogPage: vi.fn(),
    commitSelection: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

function product(id: string, title: string, sku?: string): ConnectorCatalogProduct {
  return connectorCatalogProductSchema.parse({
    providerProductId: id,
    title,
    variants: [
      {
        providerVariantId: `${id}-v`,
        sku: sku ?? null,
        price: { amountMinor: 2500, currency: 'CHF', exponent: 2 },
      },
    ],
  });
}

const CONNECTION = { id: 'c1' };

describe('useConnectorCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorsController.fetchSelection).mockResolvedValue(['1']);
    vi.mocked(ConnectorsController.fetchMappings).mockResolvedValue([
      { listingId: 'woo-1', variantId: 'v', providerProductId: '1', providerVariantId: '1-v' },
    ]);
    vi.mocked(ConnectorsController.fetchCatalogPage).mockResolvedValue({
      kind: 'connector_catalog',
      connectionId: 'c1',
      products: [product('1', 'Socks bundle', 'SOCK-1'), product('2', 'Hodler hat'), product('3', 'Cold wallet')],
      nextPage: null,
    });
  });

  async function loaded() {
    const hook = renderHook(() => useConnectorCatalog(CONNECTION));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await waitFor(() => expect(hook.result.current.isLoadingMore).toBe(false));
    return hook;
  }

  it('loads the saved choice, the published products and the store catalog', async () => {
    const { result } = await loaded();
    expect(result.current.products).toHaveLength(3);
    expect([...result.current.chosen]).toEqual(['1']);
    expect(result.current.isLocked('1')).toBe(true);
    expect(result.current.isLocked('2')).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('pages through the whole catalog so search and select all see every product', async () => {
    vi.mocked(ConnectorsController.fetchCatalogPage)
      .mockResolvedValueOnce({
        kind: 'connector_catalog',
        connectionId: 'c1',
        products: [product('1', 'One')],
        nextPage: 'p2',
      })
      .mockResolvedValueOnce({
        kind: 'connector_catalog',
        connectionId: 'c1',
        products: [product('2', 'Two')],
        nextPage: null,
      });
    const { result } = await loaded();

    expect(result.current.products.map((entry) => entry.providerProductId)).toEqual(['1', '2']);
    expect(ConnectorsController.fetchCatalogPage).toHaveBeenNthCalledWith(1, 'c1', { page: null });
    expect(ConnectorsController.fetchCatalogPage).toHaveBeenNthCalledWith(2, 'c1', { page: 'p2' });
  });

  it('searches titles, SKUs and variant titles', async () => {
    const { result } = await loaded();
    act(() => result.current.setSearch('hat'));
    expect(result.current.visible.map((entry) => entry.title)).toEqual(['Hodler hat']);
    act(() => result.current.setSearch('sock-1'));
    expect(result.current.visible.map((entry) => entry.title)).toEqual(['Socks bundle']);
    act(() => result.current.setSearch('nothing like this'));
    expect(result.current.visible).toEqual([]);
  });

  it('toggles a product and marks the choice as changed', async () => {
    const { result } = await loaded();
    act(() => result.current.toggle('2'));
    expect(result.current.chosen.has('2')).toBe(true);
    expect(result.current.dirty).toBe(true);
    act(() => result.current.toggle('2'));
    expect(result.current.dirty).toBe(false);
  });

  it('never drops a product that already has a listing', async () => {
    const { result } = await loaded();
    act(() => result.current.toggle('1'));
    expect(result.current.chosen.has('1')).toBe(true);
    act(() => result.current.clearVisible());
    expect(result.current.chosen.has('1')).toBe(true);
  });

  it('selects and clears only what the search shows', async () => {
    const { result } = await loaded();
    act(() => result.current.setSearch('cold'));
    act(() => result.current.selectVisible());
    expect([...result.current.chosen].sort()).toEqual(['1', '3']);
    act(() => result.current.clearVisible());
    expect([...result.current.chosen]).toEqual(['1']);
  });

  it('saves the whole set and settles on what the service answers', async () => {
    vi.mocked(ConnectorsController.commitSelection).mockResolvedValue(['1', '2']);
    const { result } = await loaded();
    act(() => result.current.toggle('2'));

    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });

    expect(ConnectorsController.commitSelection).toHaveBeenCalledWith('c1', ['1', '2']);
    expect(result.current.dirty).toBe(false);
    expect(toast).toHaveBeenCalledWith({ description: 'Your choice is saved.' });
  });

  it('keeps the unsaved choice and says so when saving fails', async () => {
    vi.mocked(ConnectorsController.commitSelection).mockRejectedValue(connectorRefusal('product_mapped'));
    const { result } = await loaded();
    act(() => result.current.toggle('2'));

    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });

    expect(result.current.chosen.has('2')).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('says the store catalog could not be loaded', async () => {
    vi.mocked(ConnectorsController.fetchCatalogPage).mockRejectedValue(connectorRefusal('credentials_rejected'));
    const { result } = renderHook(() => useConnectorCatalog(CONNECTION));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe('The store did not accept those keys. Check them and try again.');
  });

  it('does nothing without a connection', () => {
    const { result } = renderHook(() => useConnectorCatalog(null));
    expect(result.current.isLoading).toBe(false);
    expect(ConnectorsController.fetchSelection).not.toHaveBeenCalled();
  });
});
