'use client';

import { useSyncExternalStore } from 'react';
import { attestorKeyWindowsVersion, subscribeAttestorKeyWindows } from '@/libs/commerce/attestor-key-windows';

/**
 * A number that changes whenever an attestor's verified profile narrows the
 * trust list. Surfaces that derive a figure or a label from the trust list at
 * render call this so they render again when a profile arrives after their
 * first paint; effects that fetch trust-scoped figures list it as a
 * dependency.
 */
export function useAttestorKeyWindowsVersion(): number {
  return useSyncExternalStore(subscribeAttestorKeyWindows, attestorKeyWindowsVersion, attestorKeyWindowsVersion);
}
