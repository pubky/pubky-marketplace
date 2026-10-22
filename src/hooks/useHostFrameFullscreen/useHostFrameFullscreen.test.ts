import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShopHostWindow } from '@/libs/shop-session/bridge';
import { useHostFrameFullscreen } from './useHostFrameFullscreen';

vi.mock('@/libs/shop-session/bridge', () => ({ getShopHostWindow: vi.fn() }));

describe('useHostFrameFullscreen', () => {
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    frame = document.createElement('iframe');
    frame.setAttribute('style', 'min-height:0');
    Object.defineProperty(window, 'frameElement', { configurable: true, value: frame });
    vi.mocked(getShopHostWindow).mockReturnValue(window);
  });

  afterEach(() => {
    Object.defineProperty(window, 'frameElement', { configurable: true, value: null });
  });

  it('covers the host page with the frame while active and restores its style after', () => {
    const { rerender } = renderHook(({ active }) => useHostFrameFullscreen(active), {
      initialProps: { active: true },
    });

    expect(frame.style.position).toBe('fixed');
    expect(frame.style.zIndex).toBe('2147483647');

    rerender({ active: false });

    expect(frame.getAttribute('style')).toBe('min-height:0');
  });

  it('leaves the page alone when the Shop is not framed by its host', () => {
    vi.mocked(getShopHostWindow).mockReturnValue(null);

    renderHook(() => useHostFrameFullscreen(true));

    expect(frame.getAttribute('style')).toBe('min-height:0');
  });
});
