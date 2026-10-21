'use client';

import { useEffect, useRef, useState } from 'react';
import { getShopHostWindow } from '@/libs/shop-session/bridge';
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

/** The same-origin page that frames this Shop (the pubky.app wrapper) and the frame element in it. */
function hostFrame(): { host: Window & { visualViewport: VisualViewport }; frame: Element } | null {
  const host = getShopHostWindow();
  const frame = window.frameElement;
  if (!host?.visualViewport || !frame) return null;
  return { host: host as Window & { visualViewport: VisualViewport }, frame };
}

/**
 * The keyboard as this frame sees it, from the host page. The keyboard shrinks only the host's visual
 * viewport: inside the frame `visualViewport.height` stays equal to `innerHeight` (686 on a Pixel with
 * the keyboard up), so the frame's own viewport never shows it. The visible part of the frame is where
 * the host's visual viewport overlaps the frame element, in the frame's own coordinates. Both are taken
 * in host document coordinates: iOS scrolls the host's layout viewport as well when the keyboard opens
 * (`scrollY` 120 on an iPhone 16), so viewport-relative values disagree there.
 */
export function measureFrameViewport({
  hostViewport,
  hostLayoutHeight,
  frameTop,
  frameHeight,
  threshold,
  focusedInput,
}: {
  /** The host's visual viewport; `pageTop` is its top in the host document. */
  hostViewport: { height: number; pageTop: number };
  hostLayoutHeight: number;
  /** The frame element's top in the host document (`getBoundingClientRect().top + scrollY`). */
  frameTop: number;
  frameHeight: number;
  threshold: number;
  focusedInput: boolean;
}): KeyboardViewportState {
  const clamp = (value: number, min: number) => Math.min(frameHeight, Math.max(min, value));
  const visibleTop = clamp(hostViewport.pageTop - frameTop, 0);
  const visibleBottom = clamp(hostViewport.pageTop + hostViewport.height - frameTop, visibleTop);
  const isKeyboardVisible = hostLayoutHeight - hostViewport.height > threshold && focusedInput;
  return {
    isKeyboardVisible,
    keyboardHeight: isKeyboardVisible ? frameHeight - visibleBottom : 0,
    keyboardTop: visibleBottom,
    viewportHeight: visibleBottom - visibleTop,
    viewportOffsetTop: visibleTop,
  };
}

function measureKeyboardViewport(threshold: number): KeyboardViewportState {
  if (typeof window === 'undefined' || !window.visualViewport) {
    return getInitialViewportState();
  }

  const embed = hostFrame();
  if (embed) {
    const { host, frame } = embed;
    return measureFrameViewport({
      hostViewport: host.visualViewport,
      hostLayoutHeight: Math.max(host.innerHeight, host.document.documentElement.clientHeight),
      frameTop: frame.getBoundingClientRect().top + host.scrollY,
      frameHeight: window.innerHeight,
      threshold,
      focusedInput: isKeyboardInput(document.activeElement),
    });
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

    // Embedded, the keyboard shows only in the host page's viewport.
    const hostViewport = hostFrame()?.host.visualViewport;
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    hostViewport?.addEventListener('resize', handleViewportChange);
    hostViewport?.addEventListener('scroll', handleViewportChange);
    document.addEventListener('focusin', handleViewportChange);
    document.addEventListener('focusout', handleViewportChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      hostViewport?.removeEventListener('resize', handleViewportChange);
      hostViewport?.removeEventListener('scroll', handleViewportChange);
      document.removeEventListener('focusin', handleViewportChange);
      document.removeEventListener('focusout', handleViewportChange);
    };
  }, [debounceMs, enabled, threshold]);

  return viewportState;
}
