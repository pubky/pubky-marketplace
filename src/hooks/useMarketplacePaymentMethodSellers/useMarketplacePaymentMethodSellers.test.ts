import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { PaymentMethodFilter } from '@/libs/commerce/payment-method-filter';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useMarketplacePaymentMethodSellers } from './useMarketplacePaymentMethodSellers';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { fetchPaymentMethodCatalog: vi.fn() },
}));

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));
vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const fetchCatalog = vi.mocked(CommerceController.fetchPaymentMethodCatalog);
const FILTERS = { saleFormat: 'all' as const, conditions: [], sort: 'newest' as const, countryCode: null };
const SELLER = 'a'.repeat(52);

beforeEach(() => {
  fetchCatalog.mockReset();
  commerceConfig.mode = 'transaction-service';
  useCommerceStore.getState().reset();
});

describe('useMarketplacePaymentMethodSellers', () => {
  it('is loading until the set lands, then ready with it', async () => {
    let land: (() => void) | undefined;
    fetchCatalog.mockImplementation(
      (method) =>
        new Promise<string[]>((resolve) => {
          land = () => {
            useCommerceStore.getState().setPaymentMethodSellers(method, [SELLER]);
            resolve([SELLER]);
          };
        }),
    );
    const { result } = renderHook(() => useMarketplacePaymentMethodSellers('paypal', FILTERS));

    expect(result.current.status).toBe('loading');
    act(() => land?.());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect([...(result.current.sellers ?? [])]).toEqual([SELLER]);
  });

  it('marks only the method whose read failed as unavailable', async () => {
    fetchCatalog.mockImplementation(async (method) => {
      if (method === 'usdt') throw new TypeError('offline');
      return new Promise<string[]>(() => {});
    });
    const { result, rerender } = renderHook(
      ({ method }: { method: PaymentMethodFilter }) => useMarketplacePaymentMethodSellers(method, FILTERS),
      { initialProps: { method: 'usdt' as PaymentMethodFilter } },
    );
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    rerender({ method: 'bitcoin' });
    expect(result.current.status).toBe('loading');
  });

  it('keeps a remembered set ready even when the fresh read fails', async () => {
    useCommerceStore.getState().setPaymentMethodSellers('bitcoin', [SELLER]);
    fetchCatalog.mockRejectedValue(new TypeError('offline'));
    const { result } = renderHook(() => useMarketplacePaymentMethodSellers('bitcoin', FILTERS));

    await waitFor(() => expect(fetchCatalog).toHaveBeenCalledOnce());
    expect(result.current.status).toBe('ready');
  });

  it('is off with no method or outside the durable service', () => {
    const none = renderHook(() => useMarketplacePaymentMethodSellers(null, FILTERS));
    expect(none.result.current).toEqual({ status: 'off', sellers: null });

    commerceConfig.mode = 'sandbox';
    const sandbox = renderHook(() => useMarketplacePaymentMethodSellers('paypal', FILTERS));
    expect(sandbox.result.current).toEqual({ status: 'off', sellers: null });
    expect(fetchCatalog).not.toHaveBeenCalled();
  });
});
