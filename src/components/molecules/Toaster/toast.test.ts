import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { toast, type ToastActionDescriptor, type ToastHandle, type ToastOptions } from './toast';
import { dispatch, getSnapshot, subscribe, TOAST_DURATION, TOAST_REMOVE_DELAY } from './toast.store';
import { useToastState } from './useToastState';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Drain transient lifetimes and remove any persistent records left by a failed assertion.
    act(() => {
      vi.runAllTimers();
      for (const { id } of getSnapshot().toasts) dispatch({ type: 'REMOVE_TOAST', toastId: id });
    });
    vi.useRealTimers();
  });

  it('should add a toast with normalized defaults', () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      toast({ title: 'Saved', description: 'Your changes were saved' });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      title: 'Saved',
      description: 'Your changes were saved',
      variant: 'default',
      dismissButton: false,
      open: true,
    });
  });

  it('should keep only the latest toast when exceeding the toast limit', () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      toast({ title: 'Toast 1' });
      toast({ title: 'Toast 2' });
      toast({ title: 'Toast 3' });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe('Toast 3');
  });

  it('should create toasts with unique ids', () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      toast({ title: 'First' });
    });
    const firstId = result.current.toasts[0].id;

    act(() => {
      toast({ title: 'Second' });
    });
    const secondId = result.current.toasts[0].id;

    expect(firstId).not.toBe(secondId);
  });

  it('should auto-dismiss the toast after the toast duration via the store timer', () => {
    // The store timer owns dismissal even when Radix has paused its own timer.
    // See https://github.com/radix-ui/primitives/issues/2233
    const { result } = renderHook(() => useToastState());

    act(() => {
      toast({ title: 'Auto dismissed' });
    });
    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION - 1);
    });
    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it('should keep a persistent toast open past the toast duration', () => {
    const { result } = renderHook(() => useToastState());

    let handle: ReturnType<typeof toast> | undefined;
    act(() => {
      handle = toast({ title: 'Update available', persistent: true });
    });

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION * 2);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].open).toBe(true);
    // Persistent toasts have no timers, so the afterEach drain cannot remove them.
    act(() => {
      handle?.dismiss();
    });
  });

  it('should keep a persistent toast when later transient toasts hit the limit', () => {
    const { result } = renderHook(() => useToastState());

    let handle: ReturnType<typeof toast> | undefined;
    act(() => {
      handle = toast({ title: 'Update available', persistent: true });
      toast({ title: 'Transient 1' });
      toast({ title: 'Transient 2' });
    });

    expect(result.current.toasts.map((t) => t.title)).toEqual(['Transient 2', 'Update available']);
    act(() => {
      handle?.dismiss();
    });
  });

  it('should still dismiss a persistent toast via the returned handle', () => {
    const { result } = renderHook(() => useToastState());

    let handle: ReturnType<typeof toast> | undefined;
    act(() => {
      handle = toast({ title: 'Update available', persistent: true });
    });

    act(() => {
      handle?.dismiss();
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it('should dismiss the toast immediately via the returned handle', () => {
    const { result } = renderHook(() => useToastState());

    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: 'Dismiss me' });
    });
    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      handle.dismiss();
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it('should remove a dismissed toast from state after the removal delay', () => {
    const { result } = renderHook(() => useToastState());

    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: 'Removed later' });
    });

    act(() => {
      handle.dismiss();
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(TOAST_REMOVE_DELAY - 1);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('should cancel the auto-dismiss timer when a toast is dismissed manually', () => {
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: 'Dismissed early' });
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      handle.dismiss();
    });
    // Only the removal timer remains — a lingering auto-dismiss timer would make this 2
    expect(vi.getTimerCount()).toBe(1);
  });

  it('should cancel timers for toasts evicted by the toast limit', () => {
    act(() => {
      toast({ title: 'Evicted' });
      toast({ title: 'Survivor' });
    });

    // Only the surviving toast's auto-dismiss timer remains
    expect(vi.getTimerCount()).toBe(1);
  });

  it('should not notify subscribers when dismissing an already-dismissed toast', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: 'Once' });
      handle.dismiss();
    });
    const notifications = listener.mock.calls.length;

    act(() => {
      handle.dismiss();
    });
    expect(listener).toHaveBeenCalledTimes(notifications);

    unsubscribe();
  });
  it.each([5_000, 60_000])('keeps a custom-duration toast open for exactly %i ms', (durationMs) => {
    const { result } = renderHook(() => useToastState());
    act(() => {
      toast({ title: 'Action available', durationMs });
    });
    act(() => {
      vi.advanceTimersByTime(durationMs - 1);
    });
    expect(result.current.toasts[0].open).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts[0].open).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TOAST_REMOVE_DELAY);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2_147_483_648])(
    'falls back to the default lifetime for invalid duration %s',
    (durationMs) => {
      const { result } = renderHook(() => useToastState());
      act(() => {
        toast({ title: 'Still readable', durationMs });
        vi.advanceTimersByTime(TOAST_DURATION - 1);
      });
      expect(result.current.toasts[0].open).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.toasts[0].open).toBe(false);
    },
  );

  it('accepts the largest browser timer delay without overflowing to immediate dismissal', () => {
    const handle = toast({ title: 'Long-lived', durationMs: 2_147_483_647 });
    vi.advanceTimersByTime(60_000);
    expect(getSnapshot().toasts[0].open).toBe(true);
    handle.dismiss();
  });

  it('evicts a long transient notification and cancels its timer', () => {
    toast({ title: 'Wallet setup', durationMs: 60_000 });
    toast({ title: 'Latest notification' });
    expect(getSnapshot().toasts.map(({ title }) => title)).toEqual(['Latest notification']);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TOAST_DURATION + TOAST_REMOVE_DELAY);
    expect(getSnapshot().toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a dismissed toast removal timer when a replacement evicts it', () => {
    const handle = toast({ title: 'First' });
    handle.dismiss();
    toast({ title: 'Replacement', durationMs: 60_000 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TOAST_REMOVE_DELAY);
    expect(getSnapshot().toasts[0]).toMatchObject({ title: 'Replacement', open: true });
  });

  it('does not reset removal timing when a closed toast is dismissed again', () => {
    const handle = toast({ title: 'Dismiss once' });
    handle.dismiss();
    vi.advanceTimersByTime(TOAST_REMOVE_DELAY - 1);
    handle.dismiss();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(getSnapshot().toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a stale handle without notifying subscribers or adding timers', () => {
    const stale = toast({ title: 'Evicted' });
    toast({ title: 'Current' });
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const current = getSnapshot();
    stale.dismiss();
    unsubscribe();
    expect(getSnapshot()).toBe(current);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('removes an open record without leaving its timer behind', () => {
    toast({ title: 'Removed internally', durationMs: 60_000 });
    dispatch({ type: 'REMOVE_TOAST', toastId: getSnapshot().toasts[0].id });
    expect(getSnapshot().toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a persistent notification indefinitely with no timer', () => {
    const handle = toast({ title: 'Action required', persistent: true });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000);
    expect(getSnapshot().toasts[0].open).toBe(true);
    handle.dismiss();
  });

  it('unsubscribes a listener without affecting other subscribers', () => {
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = subscribe(listener);
    const unsubscribeOther = subscribe(other);
    unsubscribe();
    toast({ title: 'Only active subscriber' });
    unsubscribeOther();
    expect(listener).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('exposes string content, structured actions, and mutually exclusive lifetimes', () => {
    expectTypeOf<{ title: string }>().toExtend<ToastOptions>();
    expectTypeOf<{ description: string }>().toExtend<ToastOptions>();
    expectTypeOf<{ title: string; durationMs: number }>().toExtend<ToastOptions>();
    expectTypeOf<{ title: string; persistent: true }>().toExtend<ToastOptions>();
    expectTypeOf<Record<string, never>>().not.toExtend<ToastOptions>();
    expectTypeOf<{ title: ReactNode }>().not.toExtend<ToastOptions>();
    expectTypeOf<{ title: string; persistent: true; durationMs: number }>().not.toExtend<ToastOptions>();
    expectTypeOf<ToastActionDescriptor>().toEqualTypeOf<{ label: string; altText: string; onClick: () => void }>();
    expectTypeOf<ReturnType<typeof toast>>().toEqualTypeOf<ToastHandle>();
    expectTypeOf<keyof ToastHandle>().toEqualTypeOf<'dismiss'>();
  });
});
