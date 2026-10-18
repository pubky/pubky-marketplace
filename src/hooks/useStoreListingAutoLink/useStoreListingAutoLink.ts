'use client';

import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { isConnectorsUnavailableError } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { linkableListingsFrom } from '@/pipes/commerce/connector-listing-links';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * After the seller publishes listings outside a store import (a CSV import, a
 * listing made by hand), links each one that matches a product of a connected
 * store without guessing, so its stock follows the store and its orders reach
 * it. Says what it linked; a store that could not be checked is named, so an
 * unlinked listing is never missed quietly. A server without store connections
 * has nothing to link.
 */
export function useStoreListingAutoLink() {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const enabled = isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(sellerPubky);

  const run = async (): Promise<void> => {
    if (!enabled || !sellerPubky) return;
    try {
      const listings = linkableListingsFrom(await CommerceController.getListingsBySeller(sellerPubky));
      const { linked, resent, failedStores } = await ConnectorsController.commitAutoLinkAcrossStores(listings);
      if (linked > 0) {
        toast({
          title: `${linked} ${linked === 1 ? 'listing' : 'listings'} linked to your store`,
          description: `Matched by SKU or product handle, so stock and orders now sync.${
            resent > 0 ? ` ${resent} ${resent === 1 ? 'order' : 'orders'} sent again.` : ''
          }`,
        });
      }
      if (failedStores.length > 0) {
        toast({
          variant: 'warning',
          title: 'Could not check your store for matching products',
          description: `Open Store connections to link your new listings to ${failedStores
            .map((store) => store.domain)
            .join(', ')}.`,
        });
      }
    } catch (error) {
      if (isConnectorsUnavailableError(error)) return;
      toast({
        variant: 'warning',
        title: 'Could not check your store for matching products',
        description: 'Open Store connections to link your new listings to your store.',
      });
    }
  };

  return { run };
}
