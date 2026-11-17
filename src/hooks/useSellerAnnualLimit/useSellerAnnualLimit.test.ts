import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceSellerAnnualLimit } from '@/core/services/marketplace/marketplace-projections';
import { useSellerAnnualLimit } from './useSellerAnnualLimit';

const SELLER = 'y'.repeat(52);

const mocks = vi.hoisted(() => ({
  euFence: true,
  getSellerAnnualLimit: vi.fn(),
}));

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEuFenceEnabled: () => mocks.euFence,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getSellerAnnualLimit: mocks.getSellerAnnualLimit },
}));

const euResident: MarketplaceSellerAnnualLimit = {
  enabled: true,
  residentInEu: true,
  sales: 2,
  salesLimit: 30,
  eurCents: 12_000,
  eurLimitCents: 200_000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useSellerAnnualLimit', () => {
  beforeEach(() => {
    mocks.euFence = true;
    mocks.getSellerAnnualLimit.mockReset();
  });

  it('reads the limit once for a seller and stays off while the fence is off', async () => {
    mocks.getSellerAnnualLimit.mockResolvedValue(euResident);
    const { result, rerender } = renderHook(({ key }) => useSellerAnnualLimit(SELLER, key), {
      initialProps: { key: 1 },
    });

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', limit: euResident }));
    rerender({ key: 1 });
    expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(1);

    mocks.euFence = false;
    rerender({ key: 1 });
    expect(result.current).toEqual({ status: 'off' });
  });

  it('reads again when the refresh key changes, so a saved declaration shows without a reload', async () => {
    mocks.getSellerAnnualLimit.mockResolvedValueOnce({ enabled: true, residentInEu: false });
    const { result, rerender } = renderHook(({ key }) => useSellerAnnualLimit(SELLER, key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', limit: { enabled: true, residentInEu: false } });

    mocks.getSellerAnnualLimit.mockResolvedValueOnce(euResident);
    rerender({ key: 2 });

    await waitFor(() => expect(result.current).toEqual({ status: 'ready', limit: euResident }));
    expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(2);
    expect(mocks.getSellerAnnualLimit).toHaveBeenLastCalledWith(SELLER);
  });

  it('keeps the previous state on screen while the refreshed read is in flight', async () => {
    mocks.getSellerAnnualLimit.mockResolvedValueOnce(euResident);
    const { result, rerender } = renderHook(({ key }) => useSellerAnnualLimit(SELLER, key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const pending = deferred<MarketplaceSellerAnnualLimit>();
    mocks.getSellerAnnualLimit.mockReturnValueOnce(pending.promise);
    rerender({ key: 2 });
    expect(result.current).toEqual({ status: 'ready', limit: euResident });

    await act(async () => pending.resolve({ ...euResident, sales: 3 }));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', limit: { ...euResident, sales: 3 } }));
  });

  it('ignores a read that finishes after a newer one was requested', async () => {
    const first = deferred<MarketplaceSellerAnnualLimit>();
    mocks.getSellerAnnualLimit.mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(({ key }) => useSellerAnnualLimit(SELLER, key), {
      initialProps: { key: 1 },
    });

    mocks.getSellerAnnualLimit.mockResolvedValueOnce(euResident);
    rerender({ key: 2 });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', limit: euResident }));

    await act(async () => first.resolve({ enabled: true, residentInEu: false }));
    expect(result.current).toEqual({ status: 'ready', limit: euResident });
  });

  it('turns off when a refreshed read fails, since the service enforces the limit on its own', async () => {
    mocks.getSellerAnnualLimit.mockResolvedValueOnce(euResident);
    const { result, rerender } = renderHook(({ key }) => useSellerAnnualLimit(SELLER, key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mocks.getSellerAnnualLimit.mockRejectedValueOnce(new Error('unavailable'));
    rerender({ key: 2 });

    await waitFor(() => expect(result.current).toEqual({ status: 'off' }));
  });
});
