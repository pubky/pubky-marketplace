'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardViewportState, UseKeyboardViewportOptions } from './useKeyboardViewport.types';

const DEFAULT_THRESHOLD = 150;
const DEFAULT_DEBOUNCE_MS = 50;

/**
 * The layout viewport's height, which the keyboard does not shrink. On iOS Safari and Chrome
 * `window.innerHeight` shrinks with the keyboard too (695 to 490 on an iPhone 16 against a visual
 * viewport of 365), so comparing against it alone misses the keyboard; the root element's client
 * height holds.
 */
function layoutViewportHeight(): number {
  return Math.max(window.innerHeight, document.documentElement.clientHeight);
}

function getInitialViewportState(): KeyboardViewportState {
  const viewportHeight = typeof window === 'undefined' ? 0 : layoutViewportHeight();

  return {
    isKeyboardVisible: false,
    keyboardHeight: 0,
    keyboardTop: viewportHeight,
    viewportHeight,
    viewportOffsetTop: 0,
  };
}

function measureKeyboardViewport(threshold: number): KeyboardViewportState {
  if (typeof window === 'undefined' || !window.visualViewport) {
    return getInitialViewportState();
  }

  const { height } = window.visualViewport;
  const offsetTop = window.visualViewport.offsetTop ?? 0;
  const layoutHeight = layoutViewportHeight();
  const rawKeyboardHeight = layoutHeight - height - offsetTop;
  const keyboardHeight = Math.max(0, rawKeyboardHeight);
  const isKeyboardVisible = layoutHeight - height > threshold;
  const keyboardTop = height + offsetTop;

  return {
    isKeyboardVisible,
    keyboardHeight: isKeyboardVisible ? keyboardHeight : 0,
    keyboardTop,
    viewportHeight: height,
    viewportOffsetTop: offsetTop,
  };
}

export function useKeyboardViewport(options: UseKeyboardViewportOptions = {}): KeyboardViewportState {
  const { enabled = true, threshold = DEFAULT_THRESHOLD, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const [viewportState, setViewportState] = useState<KeyboardViewportState>(() => getInitialViewportState());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousVisibleRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setViewportState(getInitialViewportState());
      return;
    }

    if (typeof window === 'undefined' || !window.visualViewport) {
      setViewportState(getInitialViewportState());
      return;
    }

    const applyMeasurement = () => {
      const nextState = measureKeyboardViewport(threshold);
      previousVisibleRef.current = nextState.isKeyboardVisible;
      setViewportState(nextState);
    };

    const handleViewportChange = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const nextState = measureKeyboardViewport(threshold);

      if (previousVisibleRef.current && !nextState.isKeyboardVisible) {
        previousVisibleRef.current = nextState.isKeyboardVisible;
        setViewportState(nextState);
        return;
      }

      timeoutRef.current = setTimeout(applyMeasurement, debounceMs);
    };

    applyMeasurement();

    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [debounceMs, enabled, threshold]);

  return viewportState;
}
