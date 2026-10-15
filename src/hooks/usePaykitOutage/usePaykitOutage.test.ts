import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaykitOutage } from './usePaykitOutage';

describe('usePaykitOutage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is an outage while the config says Paykit is unreachable, and rechecks on the backoff', () => {
    const { result, rerender } = renderHook(({ unreachable }) => usePaykitOutage(unreachable), {
      initialProps: { unreachable: true },
    });
    expect(result.current).toMatchObject({ outage: true, refused: false, recheck: 0 });

    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.recheck).toBe(1);

    rerender({ unreachable: false });
    expect(result.current.outage).toBe(false);
  });

  it('keeps a refusal showing until a read from a later recheck finds Paykit reachable', () => {
    const { result } = renderHook(() => usePaykitOutage(false));
    expect(result.current.outage).toBe(false);

    act(() => result.current.markRefused());
    expect(result.current).toMatchObject({ outage: true, refused: true });

    act(() => result.current.settleRead(0, true));
    expect(result.current.refused).toBe(true);

    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.refused).toBe(true);
    expect(result.current.recheck).toBe(1);

    act(() => result.current.settleRead(1, false));
    expect(result.current.refused).toBe(true);

    act(() => result.current.settleRead(1, true));
    expect(result.current).toMatchObject({ outage: false, refused: false });
  });

  it('backs off past 5s while the refusal is unsettled, never restarting its delay', () => {
    const { result } = renderHook(() => usePaykitOutage(false));
    act(() => result.current.markRefused());

    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.recheck).toBe(1);
    act(() => vi.advanceTimersByTime(9_999));
    expect(result.current.recheck).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.recheck).toBe(2);
  });

  it('marks a second refusal against the recheck it happened on', () => {
    const { result } = renderHook(() => usePaykitOutage(false));
    act(() => result.current.markRefused());
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.settleRead(1, true));
    expect(result.current.refused).toBe(false);

    act(() => result.current.markRefused());
    act(() => result.current.settleRead(1, true));
    expect(result.current.refused).toBe(true);
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.settleRead(2, true));
    expect(result.current.refused).toBe(false);
  });
});
