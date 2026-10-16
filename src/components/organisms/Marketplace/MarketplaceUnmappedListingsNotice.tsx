'use client';

import { AlertTriangle, PackageSearch } from 'lucide-react';
import { getMarketplaceListingRoute, getStoreConnectionCatalogRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import type { UnmappedListingsNotice } from '@/hooks/useStoreConnections/useStoreConnections';
import { connectorListingRouteId } from '@/libs/commerce/connectors';

export interface MarketplaceUnmappedListingsNoticeProps {
  notice: UnmappedListingsNotice;
  /** The signed-in seller, whose listings these are. */
  sellerPubky: string | null;
  onDismiss: () => void;
}

/**
 * Shown right after the seller switches a store to one listing per size or
 * variant: the listings that combined several store variants were unlinked, and
 * each one is a link so the seller can re-import it from the catalog or end it.
 */
export function MarketplaceUnmappedListingsNotice({
  notice,
  sellerPubky,
  onDismiss,
}: MarketplaceUnmappedListingsNoticeProps) {
  return (
    <div
      role="status"
      className="grid gap-3 rounded-md border border-border p-4 text-sm"
      data-testid="store-connections-unmapped"
      data-surface="store-connections-unmapped"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="grid gap-2">
          <Typography as="p">
            These listings were combined, so they&apos;re no longer linked. Re-import them from the catalog or end them.
          </Typography>
          <Typography as="p" className="text-xs text-muted-foreground">
            Store: {notice.domain}
          </Typography>
          <ul className="grid list-none gap-1 p-0" data-testid="store-connections-unmapped-list">
            {notice.listings.map((listing) => {
              const routeId = connectorListingRouteId(listing.listingId);
              return (
                <li key={listing.listingId}>
                  {routeId && sellerPubky ? (
                    <Link
                      href={getMarketplaceListingRoute(sellerPubky, routeId)}
                      overrideDefaults
                      className="underline"
                    >
                      {listing.listingId}
                    </Link>
                  ) : (
                    listing.listingId
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="rounded-full">
          <Link href={getStoreConnectionCatalogRoute(notice.connectionId)} overrideDefaults>
            <PackageSearch className="size-4" aria-hidden="true" />
            Open the catalog
          </Link>
        </Button>
        <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
