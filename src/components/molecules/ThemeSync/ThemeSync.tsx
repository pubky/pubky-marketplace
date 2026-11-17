'use client';

import { useEffect } from 'react';
import { syncDocumentTheme } from '@/libs/theme/theme';

/**
 * Keeps the `light` class on `<html>` in step with pubky-app's shared `pubky-theme`
 * preference and the OS colour scheme after hydration. The first paint is handled by the
 * inline pre-paint script in `RootContainer`.
 */
export function ThemeSync() {
  useEffect(() => syncDocumentTheme(window), []);

  return null;
}
