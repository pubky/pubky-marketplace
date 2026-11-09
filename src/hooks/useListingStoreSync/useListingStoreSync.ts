'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getStoreSyncEnabled, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  type ConnectorConnection,
  connectorErrorMessage,
  type ConnectorSync,
  type ConnectorSyncDirection,
  type ConnectorSyncGroup,
  normalizeShopifyDomain,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { SYNC_GROUP_LABELS } from '@/pipes/commerce/connector-change-copy';
import type { FollowedGroups } from '@/pipes/commerce/listing-followed-fields';
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

type Linked = {
  connection: Pick<ConnectorConnection, 'id' | 'domain'>;
  editInStoreUrl: string | null;
  sync: ConnectorSync;
};

const LIVE = new Set(['connected', 'needs_attention']);

/** The product's page in the store's admin, only for a real `*.myshopify.com` host and a numeric product id. */
function productAdminUrl(domain: string, providerProductId: string): string | null {
  const host = normalizeShopifyDomain(domain);
  const id = /\/Product\/(\d+)$/.exec(providerProductId)?.[1];
  return host && id ? `https://${host}/admin/products/${id}` : null;
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
 * Whether a listing follows each connected store it is linked to, for its title and photos, price and
 * variants, so the editor can show those fields read-only. A listing follows a connection's setting unless
 * the seller overrides it for this listing. A part follows when any store it is linked to says so. `ready`
 * is false until the stores have been asked, so the editor does not save before it knows what is read-only;
 * a listing no store is linked to, a server with no store connections and a failed lookup all end as ready
 * with nothing followed (a later collision with the store is a conflict in the review, never a lost edit).
 */
export function useListingStoreSync(listingId: string) {
  const sellerPubky = useAuthStore((auth) => auth.currentUserPubky);
  const marketplaceSession = useCommerceStore((commerce) => commerce.marketplaceSession);
  const enabled = getStoreSyncEnabled() && isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(sellerPubky);
  const [linked, setLinked] = useState<Linked[]>([]);
  const [asked, setAsked] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setAsked(false);
    void (async () => {
      try {
        const connections = (await ConnectorsController.fetchConnections()).filter(
          (connection) => connection.provider === 'shopify' && LIVE.has(connection.status),
        );
        const found: Linked[] = [];
        for (const connection of connections) {
          const mapping = (await ConnectorsController.fetchMappings(connection.id)).find(
            (entry) => entry.listingId === listingId,
          );
          if (!mapping) continue;
          found.push({
            connection,
            editInStoreUrl: productAdminUrl(connection.domain, mapping.providerProductId),
            sync: await ConnectorsController.fetchSync(connection.id),
          });
        }
        if (current) setLinked(found);
      } catch {
        if (current) setLinked([]);
      } finally {
        if (current) setAsked(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [enabled, listingId, sellerPubky, marketplaceSession]);

  const syncs: ListingStoreSync[] = linked.map((entry) => ({
    connectionId: entry.connection.id,
    domain: entry.connection.domain,
    editInStoreUrl: entry.editInStoreUrl,
    groups: groupsOf(entry.sync, listingId),
  }));

  const follows: FollowedGroups = {
    content: syncs.some((sync) => sync.groups.content.follows),
    price: syncs.some((sync) => sync.groups.price.follows),
    variants: syncs.some((sync) => sync.groups.variants.follows),
  };

  /**
   * Switches the listing between a connection's setting and the opposite of it. Returns the group's new
   * state, or `null` when the service refused.
   */
  const toggleOverride = async (connectionId: string, group: ConnectorSyncGroup): Promise<ListingGroupSync | null> => {
    const entry = linked.find(({ connection }) => connection.id === connectionId);
    if (!entry) return null;
    const overridden = groupsOf(entry.sync, listingId)[group].overridden;
    const opposite: ConnectorSyncDirection =
      connectionDirection(entry.sync, group) === 'from_store' ? 'off' : 'from_store';
    setSaving(`${connectionId}:${group}`);
    try {
      const next = await ConnectorsController.commitListingSync(connectionId, listingId, {
        [group]: overridden ? null : opposite,
      });
      setLinked((previous) =>
        previous.map((item) => (item.connection.id === connectionId ? { ...item, sync: next } : item)),
      );
      toast({
        title: `${SYNC_GROUP_LABELS[group]}: ${overridden ? 'follows the connection' : 'set for this listing only'}`,
      });
      return groupsOf(next, listingId)[group];
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not save this setting',
        description: connectorErrorMessage(error, 'Try again in a moment.'),
      });
      return null;
    } finally {
      setSaving(null);
    }
  };

  return { ready: !enabled || asked, syncs, follows, saving, toggleOverride };
}
