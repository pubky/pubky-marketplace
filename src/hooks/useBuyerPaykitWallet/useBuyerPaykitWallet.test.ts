import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuyerPaykitWallet } from '@/libs/commerce/paykit-wallet';
import { useBuyerPaykitWallet } from './useBuyerPaykitWallet';

const controller = vi.hoisted(() => ({
  fetchBuyerPaykitWallet: vi.fn<(buyerPubky: unknown) => Promise<BuyerPaykitWallet>>(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({ CommerceController: controller }));

const BUYER = 'b'.repeat(52);

describe('useBuyerPaykitWallet', () => {
  beforeEach(() => {
    controller.fetchBuyerPaykitWallet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays idle and reads nothing while Bitcoin is not in play', () => {
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, false));
    expect(result.current.state).toBe('idle');
    expect(controller.fetchBuyerPaykitWallet).not.toHaveBeenCalled();
  });

  it('reports payable and not_payable from the public Paykit read', async () => {
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('not_payable');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true));
    expect(result.current.state).toBe('checking');
    await waitFor(() => expect(result.current.state).toBe('not_payable'));
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledWith(BUYER);

    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('payable');
    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.state).toBe('payable'));
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(2);
  });

  it('reports a Bitkit 2.6 wallet as unsupported', async () => {
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('unsupported');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true));
    await waitFor(() => expect(result.current.state).toBe('unsupported'));
  });

  it('reports an unverified wallet and reads again on recheck', async () => {
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('unverified');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true));
    await waitFor(() => expect(result.current.state).toBe('unverified'));

    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('payable');
    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.state).toBe('payable'));
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(2);
  });

  it('reports unknown, never not_payable, when the read fails', async () => {
    controller.fetchBuyerPaykitWallet.mockRejectedValueOnce(new TypeError('unreachable'));
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true));
    await waitFor(() => expect(result.current.state).toBe('unknown'));
  });

  it('checks again when Bitcoin is reselected instead of reusing a previous payable verdict', async () => {
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('payable');
    const { result, rerender } = renderHook(({ enabled }) => useBuyerPaykitWallet(BUYER, enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.state).toBe('payable'));
    rerender({ enabled: false });
    expect(result.current.state).toBe('idle');
    let finishRead!: (value: BuyerPaykitWallet) => void;
    controller.fetchBuyerPaykitWallet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    rerender({ enabled: true });
    expect(result.current.state).toBe('checking');
    await act(async () => finishRead('unsupported'));
    expect(result.current.state).toBe('unsupported');
  });

  it('watches for wallet setup without overlapping reads, then stops once payable', async () => {
    vi.useFakeTimers();
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('not_payable');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true, true));
    await act(async () => {});
    expect(result.current.state).toBe('not_payable');

    let finishRead!: (wallet: BuyerPaykitWallet) => void;
    controller.fetchBuyerPaykitWallet.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(result.current.state).toBe('checking');
    act(() => {
      result.current.recheck();
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(15000);
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(2);

    await act(async () => finishRead('payable'));
    expect(result.current.state).toBe('payable');
    act(() => {
      vi.advanceTimersByTime(30000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(2);
  });

  it('waits while hidden and checks once when returning from Bitkit', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    controller.fetchBuyerPaykitWallet.mockResolvedValue('not_payable');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true, true));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(10000));
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(1);

    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('payable');
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('payable');
  });

  it('removes polling and return listeners when the connection dialog closes or unmounts', async () => {
    vi.useFakeTimers();
    controller.fetchBuyerPaykitWallet.mockResolvedValue('not_payable');
    const { rerender, unmount } = renderHook(({ watch }) => useBuyerPaykitWallet(BUYER, true, watch), {
      initialProps: { watch: true },
    });
    await act(async () => {});
    rerender({ watch: false });
    act(() => {
      vi.advanceTimersByTime(10000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(1);
    rerender({ watch: true });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(1);
  });

  it('does not keep polling a wallet unsupported by the configured server', async () => {
    vi.useFakeTimers();
    controller.fetchBuyerPaykitWallet.mockResolvedValue('unsupported');
    const { result } = renderHook(() => useBuyerPaykitWallet(BUYER, true, true));
    await act(async () => {});
    expect(result.current.state).toBe('unsupported');
    act(() => {
      vi.advanceTimersByTime(30000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenCalledTimes(1);
  });

  it('never uses a previous account’s late response for the current account', async () => {
    let finishOldRead!: (wallet: BuyerPaykitWallet) => void;
    controller.fetchBuyerPaykitWallet.mockImplementationOnce(() => new Promise((resolve) => (finishOldRead = resolve)));
    const { result, rerender } = renderHook(({ buyer }) => useBuyerPaykitWallet(buyer, true, true), {
      initialProps: { buyer: BUYER },
    });
    controller.fetchBuyerPaykitWallet.mockResolvedValueOnce('not_payable');
    rerender({ buyer: 'c'.repeat(52) });
    await waitFor(() => expect(result.current.state).toBe('not_payable'));
    await act(async () => finishOldRead('payable'));
    expect(result.current.state).toBe('not_payable');
    expect(controller.fetchBuyerPaykitWallet).toHaveBeenLastCalledWith('c'.repeat(52));
  });
});
