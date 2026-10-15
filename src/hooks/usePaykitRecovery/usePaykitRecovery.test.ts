import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaykitRecovery } from './usePaykitRecovery';

describe('usePaykitRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays still while there is no outage', () => {
    const { result } = renderHook(() => usePaykitRecovery(false));
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current).toBe(0);
  });

  it('advances on a 5s, 10s, 20s and then 30s backoff while Paykit is down', () => {
    const { result } = renderHook(() => usePaykitRecovery(true));
    const stepsAfter = (ms: number) => {
      act(() => vi.advanceTimersByTime(ms));
      return result.current;
    };

    expect(stepsAfter(4_999)).toBe(0);
    expect(stepsAfter(1)).toBe(1);
    expect(stepsAfter(9_999)).toBe(1);
    expect(stepsAfter(1)).toBe(2);
    expect(stepsAfter(20_000)).toBe(3);
    expect(stepsAfter(30_000)).toBe(4);
    expect(stepsAfter(30_000)).toBe(5);
  });

  it('stops once Paykit is back and starts over at 5s for the next outage', () => {
    const { result, rerender } = renderHook(({ active }) => usePaykitRecovery(active), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(5_000));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(2);

    rerender({ active: false });
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current).toBe(2);

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(3);
  });

  it('clears its timer on unmount', () => {
    const { unmount } = renderHook(() => usePaykitRecovery(true));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
