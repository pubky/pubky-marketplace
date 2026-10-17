import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFillViewport } from './useFillViewport';

/** Where the page's content ends; the hook's end marker reports it. */
let contentBottom = 0;

/** A page laid out as: `top` px above the element, the element, `below` px after it. */
function layout({ top, elementHeight, below }: { top: number; elementHeight: number; below: number }) {
  const element = document.createElement('div');
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => ({ top, height: elementHeight, bottom: top + elementHeight }) as DOMRect,
  );
  contentBottom = top + elementHeight + below;
  return element;
}

describe('useFillViewport', () => {
  let resizeCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    resizeCallbacks = [];
    // The marker the hook appends to the body sits at the content's end.
    vi.spyOn(document.body, 'append').mockImplementation((...nodes: (Node | string)[]) => {
      for (const node of nodes) {
        if (node instanceof HTMLElement) {
          vi.spyOn(node, 'getBoundingClientRect').mockImplementation(
            () => ({ top: contentBottom, bottom: contentBottom, height: 0 }) as DOMRect,
          );
        }
      }
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is null before the element is measured', () => {
    const { result } = renderHook(() => useFillViewport({ current: null }));
    expect(result.current).toBeNull();
  });

  it('fills the viewport between what is above the element and what the page lays out below it', () => {
    // Overflowing page: 144 above, 640 element, 96 below in an 800 viewport.
    const element = layout({ top: 144, elementHeight: 640, below: 96 });
    const { result } = renderHook(() => useFillViewport({ current: element }));
    expect(result.current).toBe(800 - 144 - 96);
  });

  it('grows back when the viewport grows, even though the document never reports less than the viewport', () => {
    // 800 → 500 → 800: the element must return to its full height, not stay at the small one.
    const element = layout({ top: 144, elementHeight: 608, below: 48 });
    const { result, rerender } = renderHook(() => useFillViewport({ current: element }));
    expect(result.current).toBe(608);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(result.current).toBe(308);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    rerender();
    expect(result.current).toBe(608);
  });

  it('grows into free space too, and never below the minimum', () => {
    const short = layout({ top: 0, elementHeight: 300, below: 100 });
    const { result } = renderHook(() => useFillViewport({ current: short }));
    expect(result.current).toBe(700);

    const cramped = layout({ top: 700, elementHeight: 300, below: 100 });
    const { result: clamped } = renderHook(() => useFillViewport({ current: cramped }));
    expect(clamped.current).toBe(280);
  });

  it('follows the visual viewport, so an open keyboard shrinks it', () => {
    const element = layout({ top: 96, elementHeight: 588, below: 96 });
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 780,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: () => {},
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const { result } = renderHook(() => useFillViewport({ current: element }));
    expect(result.current).toBe(780 - 96 - 96);

    viewport.height = 520;
    act(() => listeners.get('resize')?.());
    expect(result.current).toBe(520 - 96 - 96);
  });

  it('re-measures when the page below changes size', () => {
    const element = layout({ top: 0, elementHeight: 600, below: 200 });
    const { result } = renderHook(() => useFillViewport({ current: element }));
    expect(result.current).toBe(600);

    contentBottom = 600 + 120;
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(result.current).toBe(680);
  });
});
