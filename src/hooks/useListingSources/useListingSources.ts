'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { ListingSourceFilter } from '@/libs/commerce/listing-table';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

type StoreSource = Exclude<ListingSourceFilter, 'manual'>;

export interface UseListingSourcesResult {
  /** The connected stores that map this listing; empty for a listing made by hand. */
  sourcesOf: (listingId: string) => readonly StoreSource[];
  /** False until the seller's store mappings have been read (or when they cannot be: no session, no service). */
  ready: boolean;
}

const NONE: readonly StoreSource[] = [];

/**
 * Where each listing came from, for the studio table's Source filter. A listing record does not say; the service
 * does, through the mappings that link a listing to a Shopify or WooCommerce product. Needs the marketplace session
 * and a transaction service, so without them `ready` stays false and the filter is not offered.
 */
export function useListingSources(): UseListingSourcesResult {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const [sources, setSources] = useState<ReadonlyMap<string, readonly StoreSource[]> | null>(null);

  useEffect(() => {
    if (!sellerPubky || !marketplaceSession || !isDurableCommerceMode(getCommerceAdapterMode())) {
      setSources(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const connections = await ConnectorsController.fetchConnections();
        const bySeller = new Map<string, Set<StoreSource>>();
        for (const connection of connections) {
          if (connection.mappingCount === 0) continue;
          for (const mapping of await ConnectorsController.fetchMappings(connection.id)) {
            const set = bySeller.get(mapping.listingId) ?? new Set<StoreSource>();
            set.add(connection.provider);
            bySeller.set(mapping.listingId, set);
          }
        }
        if (active) setSources(new Map([...bySeller].map(([listingId, set]) => [listingId, [...set]])));
      } catch {
        if (active) setSources(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [sellerPubky, marketplaceSession]);

  return { sourcesOf: (listingId) => sources?.get(listingId) ?? NONE, ready: sources !== null };
}
