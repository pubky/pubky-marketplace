'use client';

import { useMarketplaceSessionConnect } from '@/hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect';

/** Inventory and purchases share the same scoped marketplace grant approval. */
export function useMarketplaceInventoryGrantConnect(options: { onConnected?: () => void } = {}) {
  const session = useMarketplaceSessionConnect({ onConnected: options.onConnected });
  return {
    ...session,
    isOpeningSigner: session.isOpeningRing,
    openInSigner: session.openInRing,
  };
}
