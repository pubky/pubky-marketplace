import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardViewportState } from '../useKeyboardViewport/useKeyboardViewport.types';
import { useKeyboardOffset } from './useKeyboardOffset';

const mockUseKeyboardViewport = vi.hoisted(() =>
  vi.fn<() => KeyboardViewportState>(() => ({
    isKeyboardVisible: false,
    keyboardHeight: 0,
    keyboardTop: 800,
    viewportHeight: 800,
    viewportOffsetTop: 0,
  })),
);

vi.mock('../useKeyboardViewport/useKeyboardViewport', () => ({
  useKeyboardViewport: mockUseKeyboardViewport,
}));

describe('useKeyboardOffset', () => {
  beforeEach(() => {
    mockUseKeyboardViewport.mockReturnValue({
      isKeyboardVisible: false,
      keyboardHeight: 0,
      keyboardTop: 800,
      viewportHeight: 800,
      viewportOffsetTop: 0,
    });
  });

  it('reports when the keyboard is hidden', () => {
    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.isKeyboardVisible).toBe(false);
  });

  it('reports when the keyboard is visible', () => {
    mockUseKeyboardViewport.mockReturnValue({
      isKeyboardVisible: true,
      keyboardHeight: 300,
      keyboardTop: 500,
      viewportHeight: 500,
      viewportOffsetTop: 0,
    });

    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.isKeyboardVisible).toBe(true);
  });

  it('retains keyboard visibility with offset adjustment', () => {
    mockUseKeyboardViewport.mockReturnValue({
      isKeyboardVisible: true,
      keyboardHeight: 300,
      keyboardTop: 500,
      viewportHeight: 500,
      viewportOffsetTop: 0,
    });

    const { result } = renderHook(() => useKeyboardOffset({ offsetAdjustment: 100 }));
    expect(result.current.isKeyboardVisible).toBe(true);
  });

  it('retains keyboard visibility with a large adjustment', () => {
    mockUseKeyboardViewport.mockReturnValue({
      isKeyboardVisible: true,
      keyboardHeight: 300,
      keyboardTop: 500,
      viewportHeight: 500,
      viewportOffsetTop: 0,
    });

    const { result } = renderHook(() => useKeyboardOffset({ offsetAdjustment: 400 }));
    expect(result.current.isKeyboardVisible).toBe(true);
  });
});
