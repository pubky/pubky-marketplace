import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { useStoreShop } from './useStoreShop';

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

const shops = vi.hoisted(() => ({ getShop: vi.fn(), refreshShop: vi.fn() }));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getShop: shops.getShop, refreshShop: shops.refreshShop },
}));

describe('useStoreShop', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    vi.clearAllMocks();
  });

  it("returns the store seller's cached shop", async () => {
    setStoreSeller(SELLER);
    shops.getShop.mockResolvedValue({ record: { name: 'Example Ceramics' } });

    const { result } = renderHook(() => useStoreShop());

    await waitFor(() => expect(result.current?.record.name).toBe('Example Ceramics'));
    expect(shops.getShop).toHaveBeenCalledWith(SELLER);
    expect(shops.refreshShop).not.toHaveBeenCalled();
  });

  it('reads no shop outside a store', async () => {
    const { result } = renderHook(() => useStoreShop());

    await Promise.resolve();
    expect(result.current).toBeUndefined();
    expect(shops.getShop).not.toHaveBeenCalled();
    expect(shops.refreshShop).not.toHaveBeenCalled();
  });
});
