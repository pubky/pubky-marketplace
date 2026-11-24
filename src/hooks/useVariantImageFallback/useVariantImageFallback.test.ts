import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVariantImageFallback } from './useVariantImageFallback';

describe('useVariantImageFallback', () => {
  it('starts on the variant and falls back to main once', () => {
    const { result } = renderHook(() => useVariantImageFallback('/feed.png', '/main.png'));

    expect(result.current.src).toBe('/feed.png');

    act(() => result.current.onError());
    expect(result.current.src).toBe('/main.png');

    act(() => result.current.onError());
    expect(result.current.src).toBe('/main.png');
  });

  it('starts on main when no variant is available', () => {
    const { result } = renderHook(() => useVariantImageFallback(undefined, '/main.png'));

    expect(result.current.src).toBe('/main.png');
    act(() => result.current.onError());
    expect(result.current.src).toBe('/main.png');
  });

  it('does not switch when variant and main are equal', () => {
    const { result } = renderHook(() => useVariantImageFallback('/main.png', '/main.png'));

    act(() => result.current.onError());
    expect(result.current.src).toBe('/main.png');
  });

  it('resets when variant or main props change', () => {
    const { result, rerender } = renderHook(({ variantSrc, mainSrc }) => useVariantImageFallback(variantSrc, mainSrc), {
      initialProps: { variantSrc: '/feed-one.png', mainSrc: '/main-one.png' },
    });

    act(() => result.current.onError());
    expect(result.current.src).toBe('/main-one.png');

    rerender({ variantSrc: '/feed-two.png', mainSrc: '/main-two.png' });
    expect(result.current.src).toBe('/feed-two.png');

    act(() => result.current.onError());
    expect(result.current.src).toBe('/main-two.png');

    rerender({ variantSrc: '/feed-two.png', mainSrc: '/main-three.png' });
    expect(result.current.src).toBe('/feed-two.png');
  });

  it('returns the new source on the first render after the inputs change', () => {
    const renderedSrcs: string[] = [];
    const { rerender } = renderHook(
      ({ variantSrc, mainSrc }) => {
        const state = useVariantImageFallback(variantSrc, mainSrc);
        renderedSrcs.push(state.src);
        return state;
      },
      { initialProps: { variantSrc: undefined as string | undefined, mainSrc: '' } },
    );

    rerender({ variantSrc: '/feed.png', mainSrc: '/main.png' });

    expect(renderedSrcs.slice(1)).toEqual(['/feed.png']);
  });
});
