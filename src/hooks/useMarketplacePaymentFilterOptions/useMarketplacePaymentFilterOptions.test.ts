import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useMarketplacePaymentFilterOptions } from './useMarketplacePaymentFilterOptions';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { fetchUsdtPaymentsAvailable: vi.fn() },
}));

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));
vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const fetchUsdt = vi.mocked(CommerceController.fetchUsdtPaymentsAvailable);

beforeEach(() => {
  fetchUsdt.mockReset();
  commerceConfig.mode = 'transaction-service';
});

describe('useMarketplacePaymentFilterOptions', () => {
  it('offers Bitcoin and PayPal, and USDT once the capability is on', async () => {
    fetchUsdt.mockResolvedValue(true);
    const { result } = renderHook(() => useMarketplacePaymentFilterOptions());

    expect(result.current).toEqual(['bitcoin', 'paypal']);
    await waitFor(() => expect(result.current).toEqual(['bitcoin', 'usdt', 'paypal']));
  });

  it('never offers USDT while the capability is off or unreadable', async () => {
    fetchUsdt.mockResolvedValue(false);
    const off = renderHook(() => useMarketplacePaymentFilterOptions());
    await waitFor(() => expect(fetchUsdt).toHaveBeenCalledOnce());
    expect(off.result.current).toEqual(['bitcoin', 'paypal']);

    fetchUsdt.mockRejectedValue(new TypeError('offline'));
    const unreadable = renderHook(() => useMarketplacePaymentFilterOptions());
    await waitFor(() => expect(fetchUsdt).toHaveBeenCalledTimes(2));
    expect(unreadable.result.current).toEqual(['bitcoin', 'paypal']);
  });

  it('offers nothing outside the durable service and reads no capability', () => {
    commerceConfig.mode = 'sandbox';
    const { result } = renderHook(() => useMarketplacePaymentFilterOptions());

    expect(result.current).toEqual([]);
    expect(fetchUsdt).not.toHaveBeenCalled();
  });
});
