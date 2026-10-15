'use client';

import { MarketplaceSessionConnectDialog } from './MarketplaceSessionConnectDialog';

/** Inventory uses the marketplace grant, which covers its service-owned stock path. */
export function MarketplaceInventoryGrantDialog({
  triggerLabel = 'Approve in your Pubky signer',
  onConnected,
  autoOpen = false,
}: {
  triggerLabel?: string;
  onConnected?: () => void;
  autoOpen?: boolean;
}) {
  return (
    <MarketplaceSessionConnectDialog
      triggerLabel={triggerLabel}
      onConnected={onConnected}
      autoOpen={autoOpen}
      intent="sell"
    />
  );
}
