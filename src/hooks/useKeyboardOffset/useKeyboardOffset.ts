'use client';

import { useKeyboardViewport } from '@/hooks/useKeyboardViewport/useKeyboardViewport';
import type { UseKeyboardOffsetOptions } from './useKeyboardOffset.types';

/** Observes keyboard visibility. Offset options remain accepted for compatibility. */
export function useKeyboardOffset(_options: UseKeyboardOffsetOptions = {}) {
  const { isKeyboardVisible } = useKeyboardViewport();

  return { isKeyboardVisible };
}
