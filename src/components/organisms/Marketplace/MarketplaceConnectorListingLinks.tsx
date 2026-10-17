'use client';

import { useState } from 'react';
import { AlertTriangle, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { getMarketplaceListingRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import {
  type UnlinkedListingRow,
  useConnectorListingLinks,
} from '@/hooks/useConnectorListingLinks/useConnectorListingLinks';
import {
  type ConnectorCatalogProduct,
  type ConnectorConnection,
  connectorListingRouteId,
} from '@/libs/commerce/connectors';
import { unlinkedReasonCopy, variantPicks } from '@/pipes/commerce/connector-listing-links';
import { useAuthStore } from '@/stores/auth/auth.store';

/** The anchor of a connection's unlinked listings, which the Orders page links to. */
export function listingLinksAnchorId(connectionId: string): string {
  return `listing-links-${connectionId}`;
}

function variantLabel(options: Readonly<Record<string, string>>, sku: string | null | undefined, id: string): string {
  return Object.values(options).join(' · ') || sku || id;
}

function storeVariantLabel(product: ConnectorCatalogProduct, providerVariantId: string): string {
  const variant = product.variants.find((entry) => entry.providerVariantId === providerVariantId);
  if (!variant) return providerVariantId;
  const choice = variant.optionValues.map(({ value }) => value).join(' / ') || variant.title || 'Default';
  return variant.sku ? `${choice} (${variant.sku})` : choice;
}

type RowProps = {
  row: UnlinkedListingRow;
  products: readonly ConnectorCatalogProduct[];
  sellerPubky: string | null;
  linking: boolean;
  onLink: (product: ConnectorCatalogProduct, picks: Readonly<Record<string, string | null>>) => void;
};

function UnlinkedRow({ row, products, sellerPubky, linking, onLink }: RowProps) {
  const [productId, setProductId] = useState<string>('');
  const [picks, setPicks] = useState<Readonly<Record<string, string | null>>>({});
  const product = products.find((entry) => entry.providerProductId === productId) ?? null;
  const offered = row.listing.variants.filter((variant) => variant.enabled);
  const routeId = connectorListingRouteId(row.listing.listingId);
  const complete = product !== null && offered.every((variant) => picks[variant.id]);

  const chooseProduct = (next: string) => {
    setProductId(next);
    const chosen = products.find((entry) => entry.providerProductId === next);
    setPicks(chosen ? variantPicks(row.listing, chosen) : {});
  };

  return (
    <li
      className="grid gap-3 rounded-md border border-border p-4"
      data-testid={`listing-link-row-${row.listing.listingId}`}
    >
      <div className="grid gap-1 text-sm">
        <Typography as="p" className="font-semibold">
          {routeId && sellerPubky ? (
            <Link href={getMarketplaceListingRoute(sellerPubky, routeId)} overrideDefaults className="hover:underline">
              {row.listing.title}
            </Link>
          ) : (
            row.listing.title
          )}
        </Typography>
        <Typography as="p" className="text-muted-foreground">
          {unlinkedReasonCopy(row.reason)}
        </Typography>
      </div>
      {row.reason !== 'split_multi_variant' && products.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Select value={productId} onValueChange={chooseProduct}>
              <SelectTrigger theme="secondary" className="w-full" aria-label={`Store product for ${row.listing.title}`}>
                <SelectValue placeholder="Choose the product in your store" />
              </SelectTrigger>
              <SelectContent>
                {products.map((entry) => (
                  <SelectItem key={entry.providerProductId} value={entry.providerProductId}>
                    {entry.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {product &&
              (offered.length > 1 || product.variants.length > 1) &&
              offered.map((variant) => (
                <div key={variant.id} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                  <Typography as="span" className="text-sm text-muted-foreground">
                    {variantLabel(variant.options, variant.sku, variant.id)}
                  </Typography>
                  <Select
                    value={picks[variant.id] ?? ''}
                    onValueChange={(next) => setPicks({ ...picks, [variant.id]: next })}
                  >
                    <SelectTrigger
                      theme="secondary"
                      className="w-full"
                      aria-label={`Store variant for ${variantLabel(variant.options, variant.sku, variant.id)}`}
                    >
                      <SelectValue placeholder="Choose the variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {product.variants.map((entry) => (
                        <SelectItem key={entry.providerVariantId} value={entry.providerVariantId}>
                          {storeVariantLabel(product, entry.providerVariantId)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            disabled={!complete || linking}
            onClick={() => product && onLink(product, picks)}
          >
            {linking ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="size-4" aria-hidden="true" />
            )}
            Link
          </Button>
        </div>
      )}
    </li>
  );
}

export interface MarketplaceConnectorListingLinksProps {
  connection: Pick<ConnectorConnection, 'id' | 'provider' | 'domain' | 'status' | 'variantMode'>;
}

/**
 * Under a connected store: the seller's listings that are not linked to any
 * of its products, so their orders are not sent there and their stock does not
 * follow it. Listings that match without guessing are linked as the page
 * opens; each other one can be linked here in a click or two. Renders nothing
 * while it checks and when every listing is linked.
 */
export function MarketplaceConnectorListingLinks({ connection }: MarketplaceConnectorListingLinksProps) {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const links = useConnectorListingLinks(connection);
  const { state } = links;

  if (state.status === 'failed') {
    return (
      <div
        role="alert"
        id={listingLinksAnchorId(connection.id)}
        className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        data-testid="listing-links-failed"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          {state.message}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => void links.check()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Check again
        </Button>
      </div>
    );
  }
  if (state.status !== 'ready' || state.unlinked.length === 0) return null;

  const count = state.unlinked.length;
  return (
    <Card
      id={listingLinksAnchorId(connection.id)}
      className="rounded-md p-0 shadow-lg"
      data-surface="listing-links"
      data-testid="listing-links"
    >
      <CardContent className="grid gap-4 p-6">
        <div className="grid gap-1">
          <Heading level={2} size="md">
            {count} {count === 1 ? 'listing is' : 'listings are'} not linked to {connection.domain}
          </Heading>
          <Typography as="p" className="text-sm text-muted-foreground">
            Orders for {count === 1 ? 'it' : 'them'} are not sent to your {links.store} store, and{' '}
            {count === 1 ? 'its' : 'their'} stock does not follow it. Link each one to its product in your store. If you
            sell a listing only on Pubky, you can leave it as it is.
          </Typography>
        </div>
        <ul className="grid list-none gap-3 p-0">
          {state.unlinked.map((row) => (
            <UnlinkedRow
              key={row.listing.listingId}
              row={row}
              products={state.products}
              sellerPubky={sellerPubky}
              linking={links.linkingId === row.listing.listingId}
              onLink={(product, picks) => void links.linkByHand(row.listing, product, picks)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
