'use client';

import { useEffect, useState } from 'react';
import type { ListingLinkResult } from '@/application/connectors/connectors';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  CONNECTOR_PROVIDER_LABELS,
  type ConnectorCatalogProduct,
  type ConnectorConnection,
  connectorErrorMessage,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import {
  type LinkableListing,
  linkableListingsFrom,
  mappingsFromPicks,
  type UnlinkedReason,
} from '@/pipes/commerce/connector-listing-links';
import { useAuthStore } from '@/stores/auth/auth.store';

type LinkConnection = Pick<ConnectorConnection, 'id' | 'provider' | 'domain' | 'status' | 'variantMode'>;

export type UnlinkedListingRow = {
  listing: LinkableListing;
  reason: UnlinkedReason;
};

export type ListingLinksState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; unlinked: UnlinkedListingRow[]; products: ConnectorCatalogProduct[] }
  | { status: 'failed'; message: string };

const CHECK_FAILED = 'Your listings could not be checked against the store. Try again in a moment.';
const LINK_FAILED = 'The listing could not be linked. Try again in a moment.';

function isLive(connection: LinkConnection | null): connection is LinkConnection {
  return connection !== null && (connection.status === 'connected' || connection.status === 'needs_attention');
}

function resentCopy(resent: number): string {
  return resent > 0 ? ` ${resent} ${resent === 1 ? 'order that was' : 'orders that were'} not sent went again.` : '';
}

/**
 * Keeps the seller's own listings (made by hand or imported from a CSV)
 * linked to the connected store. When the page opens it links every listing
 * that matches a store product without guessing (SKU, or Shopify handle and
 * options) and resends the orders that waited for it, then lists the rest so
 * the seller can match each one by hand. Nothing fails quietly: a failed check
 * is shown, and every link made is announced.
 */
export function useConnectorListingLinks(connection: LinkConnection | null) {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const [state, setState] = useState<ListingLinksState>({ status: 'idle' });
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const live = isLive(connection);
  const store = connection ? CONNECTOR_PROVIDER_LABELS[connection.provider] : '';

  const apply = (result: ListingLinkResult, listings: readonly LinkableListing[]) => {
    const byId = new Map(listings.map((listing) => [listing.listingId, listing]));
    setState({
      status: 'ready',
      products: result.products,
      unlinked: result.unlinked.flatMap(({ listingId, reason }) => {
        const listing = byId.get(listingId);
        return listing ? [{ listing, reason }] : [];
      }),
    });
    if (result.linked.length > 0) {
      const count = result.linked.length;
      toast({
        title: `${count} ${count === 1 ? 'listing' : 'listings'} linked to ${store}`,
        description: `Matched by SKU or product handle, so stock and orders now sync.${resentCopy(result.resent)}`,
      });
    }
  };

  const check = async (): Promise<boolean> => {
    if (!isLive(connection) || !sellerPubky) return false;
    setState({ status: 'loading' });
    try {
      const listings = linkableListingsFrom(await CommerceController.getListingsBySeller(sellerPubky));
      const result = await ConnectorsController.commitAutoLinkListings(connection, listings);
      apply(result, listings);
      return true;
    } catch (error) {
      setState({ status: 'failed', message: connectorErrorMessage(error, CHECK_FAILED) });
      return false;
    }
  };

  useEffect(() => {
    if (!live || !sellerPubky) return;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id, live, sellerPubky]);

  /** Links one listing to the product and variants the seller chose. */
  const linkByHand = async (
    listing: LinkableListing,
    product: ConnectorCatalogProduct,
    picks: Readonly<Record<string, string | null>>,
  ): Promise<boolean> => {
    if (!isLive(connection) || state.status !== 'ready') return false;
    const mappings = mappingsFromPicks(listing, product, picks);
    if (!mappings) {
      toast({ variant: 'warning', description: 'Choose a different store variant for each variant of the listing.' });
      return false;
    }
    setLinkingId(listing.listingId);
    try {
      const { linked, resent } = await ConnectorsController.commitLinkListing(connection.id, mappings);
      if (!linked) {
        toast({ variant: 'warning', description: 'This listing is not registered for checkout yet. Try again later.' });
        return false;
      }
      setState({
        ...state,
        unlinked: state.unlinked.filter((row) => row.listing.listingId !== listing.listingId),
      });
      toast({ title: `Linked to ${product.title}`, description: `Stock and orders now sync.${resentCopy(resent)}` });
      return true;
    } catch (error) {
      toast({ variant: 'error', description: connectorErrorMessage(error, LINK_FAILED) });
      return false;
    } finally {
      setLinkingId(null);
    }
  };

  return { state, linkingId, check, linkByHand, store };
}
