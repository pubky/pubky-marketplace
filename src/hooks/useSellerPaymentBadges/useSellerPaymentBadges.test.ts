import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useSellerPaymentBadges } from './useSellerPaymentBadges';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { fetchSellerPaymentBadges: vi.fn() },
}));

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));
vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const fetchBadges = vi.mocked(CommerceController.fetchSellerPaymentBadges);
const SELLER_A = 'a'.repeat(52);
const SELLER_B = 'b'.repeat(52);

beforeEach(() => {
  fetchBadges.mockReset();
  commerceConfig.mode = 'transaction-service';
  useCommerceStore.getState().reset();
});

describe('useSellerPaymentBadges', () => {
  it('shows the resolved badges for the seller', async () => {
    fetchBadges.mockResolvedValue(['bitcoin', 'paypal']);
    const { result } = renderHook(() => useSellerPaymentBadges(SELLER_A));

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(['bitcoin', 'paypal']));
    expect(fetchBadges).toHaveBeenCalledWith(SELLER_A);
  });

  it('shows the remembered set while the read is in flight', () => {
    useCommerceStore.getState().setSellerPaymentBadges(SELLER_A, ['usdt']);
    fetchBadges.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSellerPaymentBadges(SELLER_A));

    expect(result.current).toEqual(['usdt']);
  });

  it('shows nothing when the read fails and nothing is remembered', async () => {
    fetchBadges.mockResolvedValue(null);
    const { result } = renderHook(() => useSellerPaymentBadges(SELLER_A));

    await waitFor(() => expect(fetchBadges).toHaveBeenCalledOnce());
    expect(result.current).toEqual([]);
  });

  it("never shows one seller's badges for another", async () => {
    fetchBadges.mockResolvedValueOnce(['paypal']).mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook(({ seller }) => useSellerPaymentBadges(seller), {
      initialProps: { seller: SELLER_A },
    });
    await waitFor(() => expect(result.current).toEqual(['paypal']));

    rerender({ seller: SELLER_B });
    expect(result.current).toEqual([]);
  });

  it('reads nothing outside the durable service', () => {
    commerceConfig.mode = 'sandbox';
    const { result } = renderHook(() => useSellerPaymentBadges(SELLER_A));

    expect(result.current).toEqual([]);
    expect(fetchBadges).not.toHaveBeenCalled();
  });
});
