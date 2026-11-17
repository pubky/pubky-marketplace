'use client';

import { useConnectorChanges } from '@/hooks/useConnectorChanges/useConnectorChanges';
import { useConnectorSync } from '@/hooks/useConnectorSync/useConnectorSync';
import type { ConnectorConnection } from '@/libs/commerce/connectors';
import { MarketplaceConnectorChanges } from './MarketplaceConnectorChanges';
import { MarketplaceConnectorSyncSettings } from './MarketplaceConnectorSyncSettings';

export interface MarketplaceConnectorProductSyncProps {
  connection: Pick<ConnectorConnection, 'id' | 'domain' | 'provider'>;
}

/**
 * A Shopify connection's product sync: the changes waiting for the seller, then the Sync table. Changing
 * a direction drops that group's pending changes in the service, so the review reads them again.
 */
export function MarketplaceConnectorProductSync({ connection }: MarketplaceConnectorProductSyncProps) {
  const changes = useConnectorChanges(connection.id);
  const sync = useConnectorSync(connection.id, { onSaved: () => void changes.refresh() });
  return (
    <>
      <MarketplaceConnectorChanges connection={connection} changes={changes} />
      <MarketplaceConnectorSyncSettings connection={connection} sync={sync} />
    </>
  );
}
