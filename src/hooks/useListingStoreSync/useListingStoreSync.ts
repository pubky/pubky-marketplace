'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  type ConnectorConnection,
  connectorErrorMessage,
  type ConnectorSync,
  type ConnectorSyncDirection,
  type ConnectorSyncGroup,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { SYNC_GROUP_LABELS } from '@/pipes/commerce/connector-change-copy';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

export type ListingGroupSync = {
  /** Whether the listing follows the store for the group: its override, else the connection's setting. */
  follows: boolean;
  /** The listing has its own setting for the group instead of the connection's. */
  overridden: boolean;
};

export type ListingStoreSync = {
  connectionId: string;
  domain: string;
  /** The store's admin page for the linked product, where a field that follows the store is edited. */
  editInStoreUrl: string | null;
  groups: Readonly<Record<ConnectorSyncGroup, ListingGroupSync>>;
};

const LIVE = new Set(['connected', 'needs_attention']);

function productAdminUrl(domain: string, providerProductId: string): string | null {
  const id = /\/Product\/(\d+)$/.exec(providerProductId)?.[1];
  return id ? `https://${domain}/admin/products/${id}` : null;
}

function groupsOf(sync: ConnectorSync, listingId: string): ListingStoreSync['groups'] {
  const entry = (group: ConnectorSyncGroup): ListingGroupSync => {
    const connection = sync.groups.find((candidate) => candidate.fieldGroup === group)?.direction ?? 'off';
    const override = sync.overrides.find((item) => item.listingId === listingId && item.fieldGroup === group);
    return { follows: (override?.direction ?? connection) === 'from_store', overridden: override !== undefined };
  };
  return { content: entry('content'), price: entry('price'), variants: entry('variants') };
}

function connectionDirection(sync: ConnectorSync, group: ConnectorSyncGroup): ConnectorSyncDirection {
  return sync.groups.find((candidate) => candidate.fieldGroup === group)?.direction ?? 'off';
}

/**
 * Whether a listing follows a connected store for its title and photos, price and variants, so the editor
 * can show those fields read-only. A listing follows the connection's setting unless the seller overrides
 * it for this listing. A listing no store is linked to (or a server with no store connections) has none.
 */
export function useListingStoreSync(listingId: string) {
  const sellerPubky = useAuthStore((auth) => auth.currentUserPubky);
  const marketplaceSession = useCommerceStore((commerce) => commerce.marketplaceSession);
  const enabled = isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(sellerPubky);
  const [linked, setLinked] = useState<{
    connection: Pick<ConnectorConnection, 'id' | 'domain'>;
    editInStoreUrl: string | null;
    sync: ConnectorSync;
  } | null>(null);
  const [savingGroup, setSavingGroup] = useState<ConnectorSyncGroup | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void (async () => {
      try {
        const connections = (await ConnectorsController.fetchConnections()).filter(
          (connection) => connection.provider === 'shopify' && LIVE.has(connection.status),
        );
        for (const connection of connections) {
          const mapping = (await ConnectorsController.fetchMappings(connection.id)).find(
            (entry) => entry.listingId === listingId,
          );
          if (!mapping) continue;
          const sync = await ConnectorsController.fetchSync(connection.id);
          if (current) {
            setLinked({
              connection,
              editInStoreUrl: productAdminUrl(connection.domain, mapping.providerProductId),
              sync,
            });
          }
          return;
        }
        if (current) setLinked(null);
      } catch {
        if (current) setLinked(null);
      }
    })();
    return () => {
      current = false;
    };
  }, [enabled, listingId, sellerPubky, marketplaceSession]);

  const sync: ListingStoreSync | null = linked
    ? {
        connectionId: linked.connection.id,
        domain: linked.connection.domain,
        editInStoreUrl: linked.editInStoreUrl,
        groups: groupsOf(linked.sync, listingId),
      }
    : null;

  /** Switches the listing between the connection's setting and the opposite of it. */
  const toggleOverride = async (group: ConnectorSyncGroup): Promise<boolean> => {
    if (!linked) return false;
    const overridden = groupsOf(linked.sync, listingId)[group].overridden;
    const opposite: ConnectorSyncDirection =
      connectionDirection(linked.sync, group) === 'from_store' ? 'off' : 'from_store';
    setSavingGroup(group);
    try {
      const next = await ConnectorsController.commitListingSync(linked.connection.id, listingId, {
        [group]: overridden ? null : opposite,
      });
      setLinked({ ...linked, sync: next });
      toast({
        title: `${SYNC_GROUP_LABELS[group]}: ${overridden ? 'follows the connection' : 'set for this listing only'}`,
      });
      return true;
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not save this setting',
        description: connectorErrorMessage(error, 'Try again in a moment.'),
      });
      return false;
    } finally {
      setSavingGroup(null);
    }
  };

  return { sync, savingGroup, toggleOverride };
}
