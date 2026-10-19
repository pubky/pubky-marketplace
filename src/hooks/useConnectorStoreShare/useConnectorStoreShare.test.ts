import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorShareChoice } from '@/application/commerce/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useConnectorStoreShare } from './useConnectorStoreShare';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getConnectorStores: vi.fn() },
}));

const SELLER = 's'.repeat(52);
const OTHER = 'o'.repeat(52);

function store(sellerPubky: string): ConnectorShareChoice {
  return { sellerPubky, shopDomain: 'dezentralshop.ch', keyId: 'connector-key-1', publicKey: new Uint8Array(32) };
}

describe('useConnectorStoreShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CommerceController.getConnectorStores).mockResolvedValue(new Map([[SELLER, store(SELLER)]]));
  });

  it('offers a store only for a shipped seller that has one, and starts with nothing shared', async () => {
    const { result } = renderHook(() => useConnectorStoreShare([SELLER, OTHER]));
    await waitFor(() => expect(result.current.stores.size).toBe(1));

    expect(CommerceController.getConnectorStores).toHaveBeenCalledWith([OTHER, SELLER].sort());
    expect([...result.current.stores.keys()]).toEqual([SELLER]);
    expect(result.current.chosen.size).toBe(0);
    expect(result.current.selected).toEqual([]);
  });

  it('shares only after the buyer ticks, per seller, and can be switched off again', async () => {
    const { result } = renderHook(() => useConnectorStoreShare([SELLER]));
    await waitFor(() => expect(result.current.stores.size).toBe(1));

    act(() => result.current.setShare(SELLER, true));
    expect(result.current.selected.map((entry) => entry.sellerPubky)).toEqual([SELLER]);

    act(() => result.current.setShare(SELLER, false));
    expect(result.current.selected).toEqual([]);
  });

  it('ignores a tick for a seller without a store', async () => {
    const { result } = renderHook(() => useConnectorStoreShare([SELLER, OTHER]));
    await waitFor(() => expect(result.current.stores.size).toBe(1));
    act(() => result.current.setShare(OTHER, true));
    expect(result.current.selected).toEqual([]);
  });

  it('drops a choice when the seller leaves the checkout', async () => {
    const { result, rerender } = renderHook(({ sellers }) => useConnectorStoreShare(sellers), {
      initialProps: { sellers: [SELLER] },
    });
    await waitFor(() => expect(result.current.stores.size).toBe(1));
    act(() => result.current.setShare(SELLER, true));

    vi.mocked(CommerceController.getConnectorStores).mockResolvedValue(new Map());
    rerender({ sellers: [OTHER] });

    await waitFor(() => expect(result.current.stores.size).toBe(0));
    expect(result.current.selected).toEqual([]);
  });

  it('asks nothing when no seller ships', async () => {
    const { result } = renderHook(() => useConnectorStoreShare([]));
    await waitFor(() => expect(result.current.stores.size).toBe(0));
    expect(CommerceController.getConnectorStores).not.toHaveBeenCalled();
  });
});
