'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardViewportState, UseKeyboardViewportOptions } from './useKeyboardViewport.types';

const DEFAULT_THRESHOLD = 150;
const DEFAULT_DEBOUNCE_MS = 50;

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
  'button',
  'submit',
  'reset',
]);

/** Whether focusing `target` brings up the soft keyboard. */
export function isKeyboardInput(target: Element | null): target is HTMLElement {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable === true;
}

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
  // A pinch-zoom shrinks the visual viewport too (iOS ignores `userScalable: false`); only a focused text field
  // means a keyboard.
  const isKeyboardVisible = layoutHeight - height > threshold && isKeyboardInput(document.activeElement);
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
    document.addEventListener('focusin', handleViewportChange);
    document.addEventListener('focusout', handleViewportChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      document.removeEventListener('focusin', handleViewportChange);
      document.removeEventListener('focusout', handleViewportChange);
    };
  }, [debounceMs, enabled, threshold]);

  return viewportState;
}
