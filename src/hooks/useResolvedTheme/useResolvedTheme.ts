'use client';

import { useSyncExternalStore } from 'react';
import type { ResolvedTheme } from '@/config/theme';
import { readResolvedTheme, subscribeToThemeChanges } from '@/libs/theme/theme';

const subscribe = (onChange: () => void) => subscribeToThemeChanges(window, onChange);
const getSnapshot = (): ResolvedTheme => readResolvedTheme(window);
const getServerSnapshot = (): ResolvedTheme => 'dark';

/**
 * The colour scheme the Shop is painted in (`dark` | `light`), following pubky-app's shared
 * `pubky-theme` preference live. For components that cannot take the `.light` CSS tokens, such
 * as widgets rendered in their own Shadow DOM. The server and hydration render read `dark`.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
