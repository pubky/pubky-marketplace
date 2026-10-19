import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useSellerPaymentMethodGate } from './useSellerPaymentMethodGate';

const OWNER = 'y'.repeat(52);
const authState = vi.hoisted(() => ({ currentUserPubky: 'y'.repeat(52) as string | null }));
const commerceMode = vi.hoisted(() => ({ mode: 'transaction-service' as 'sandbox' | 'transaction-service' }));

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return {
    ...actual,
    getCommerceAdapterMode: () => commerceMode.mode,
  };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null }) => unknown) => selector(authState),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getSellerPaymentConfig: vi.fn(),
    fetchUsdtPaymentsAvailable: vi.fn(),
  },
}));

describe('useSellerPaymentMethodGate', () => {
  beforeEach(() => {
    authState.currentUserPubky = OWNER;
    commerceMode.mode = 'transaction-service';
    vi.mocked(CommerceController.getSellerPaymentConfig).mockReset();
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockReset().mockResolvedValue(true);
  });

  it('skips the lookup in sandbox mode', () => {
    commerceMode.mode = 'sandbox';
    const { result } = renderHook(() => useSellerPaymentMethodGate());

    expect(result.current).toEqual({ isDurable: false, ready: true, reason: null });
    expect(CommerceController.getSellerPaymentConfig).not.toHaveBeenCalled();
  });

  it('reports no-method when the seller has no buyer-payable rail', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });

    const { result } = renderHook(() => useSellerPaymentMethodGate());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toEqual({ isDurable: true, ready: true, reason: 'no-method' });
  });

  it('clears the gate for a USDT-only seller while the deployment offers USDT', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
      usdtAvailable: true,
      acceptedAssets: ['USDT'],
    });

    const { result } = renderHook(() => useSellerPaymentMethodGate());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.reason).toBeNull();
  });

  it('still reports no-method for a USDT-only seller when the deployment does not offer USDT', async () => {
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
      usdtAvailable: true,
      acceptedAssets: ['USDT'],
    });

    const { result } = renderHook(() => useSellerPaymentMethodGate());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.reason).toBe('no-method');
  });

  it('clears the gate when a payable method is configured', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });

    const { result } = renderHook(() => useSellerPaymentMethodGate());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.reason).toBeNull();
  });

  describe('a Paykit outage', () => {
    const outage = {
      bitcoinAvailable: false,
      bitcoinOfferAvailable: false,
      paypalAvailable: false,
      paykitUnreachable: true,
    };
    const healthy = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false };

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reports the outage instead of no-method, retries on its own and clears when Paykit is back', async () => {
      vi.mocked(CommerceController.getSellerPaymentConfig)
        .mockResolvedValueOnce(outage)
        .mockResolvedValueOnce(outage)
        .mockResolvedValue(healthy);

      const { result } = renderHook(() => useSellerPaymentMethodGate());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current).toEqual({ isDurable: true, ready: true, reason: 'paykit-unreachable' });
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(2);
      expect(result.current.reason).toBe('paykit-unreachable');
      expect(result.current.ready).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(3);
      expect(result.current).toEqual({ isDurable: true, ready: true, reason: null });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(3);
    });

    it('does not poll for a seller who simply has no method', async () => {
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
        bitcoinAvailable: false,
        bitcoinOfferAvailable: true,
        paypalAvailable: false,
      });
      const { result } = renderHook(() => useSellerPaymentMethodGate());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(result.current.reason).toBe('no-method');
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledTimes(1);
    });
  });
});
