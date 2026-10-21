import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHideOnScroll } from './useHideOnScroll';

const frames: FrameRequestCallback[] = [];

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    window.dispatchEvent(new Event('scroll'));
    frames.splice(0).forEach((callback) => callback(0));
  });
}

describe('useHideOnScroll', () => {
  beforeEach(() => {
    frames.length = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('hides while scrolling down past the offset and returns on scroll up', () => {
    const { result } = renderHook(() => useHideOnScroll());

    scrollTo(60);
    expect(result.current).toBe(false);
    scrollTo(400);
    expect(result.current).toBe(true);
    scrollTo(300);
    expect(result.current).toBe(false);
  });

  it('ignores movements under the tolerance', () => {
    const { result } = renderHook(() => useHideOnScroll());

    scrollTo(400);
    expect(result.current).toBe(true);
    scrollTo(395);
    expect(result.current).toBe(true);
  });

  it('comes back near the top and stays put when disabled', () => {
    const { result, rerender } = renderHook(({ enabled }) => useHideOnScroll({ enabled }), {
      initialProps: { enabled: true },
    });

    scrollTo(400);
    scrollTo(500);
    expect(result.current).toBe(true);
    scrollTo(40);
    expect(result.current).toBe(false);

    rerender({ enabled: false });
    scrollTo(800);
    expect(result.current).toBe(false);
  });
});
