'use client';

import { useEffect } from 'react';
import { ClientRegionController } from '@/controllers/client-region/client-region';
import type { ClientRegionState } from '@/libs/commerce/commerce-availability';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';

/**
 * The visitor's IP country, for the Market's commerce surfaces only. It asks the Shop's
 * `/api/marketplace/client-region` route, once per page load and again whenever the visitor comes back to the tab, and only while the region policy blocks
 * a region (or an unknown visitor). With no region blocked it is `off` and makes no request.
 * Only Market surfaces call it, so a page outside the Market never reads the visitor's region.
 */
export function useClientRegion(): ClientRegionState {
  const enabled = getRegionPolicy().usesClientRegion;
  const status = useClientRegionStore((state) => state.status);
  const country = useClientRegionStore((state) => state.country);

  useEffect(() => {
    if (enabled) void ClientRegionController.ensureLoaded();
  }, [enabled]);

  // Coming back to the tab after a VPN switch must not need a reload.
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void ClientRegionController.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);

  if (!enabled) return { status: 'off' };
  if (status === 'ready') return { status, country };
  if (status === 'failed') return { status };
  return { status: 'loading' };
}
