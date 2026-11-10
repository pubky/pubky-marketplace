'use client';

import { AlertTriangle, LoaderCircle, PackageSearch, RefreshCw } from 'lucide-react';
import { getMarketplaceListingRoute, getStoreConnectionCatalogRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import {
  CHANGE_FAILURE_COPY,
  type ReviewItem,
  type useConnectorChanges,
} from '@/hooks/useConnectorChanges/useConnectorChanges';
import { type ConnectorConnection, connectorListingRouteId } from '@/libs/commerce/connectors';
import {
  CHANGE_HEADLINES,
  describeConflict,
  describeFieldChange,
  newVariantsCopy,
  unsupportedCopy,
} from '@/pipes/commerce/connector-change-copy';
import { useAuthStore } from '@/stores/auth/auth.store';

function connectorChangesAnchorId(connectionId: string): string {
  return `store-changes-${connectionId}`;
}

type Changes = ReturnType<typeof useConnectorChanges>;

export interface MarketplaceConnectorChangesProps {
  connection: Pick<ConnectorConnection, 'id' | 'domain' | 'provider'>;
  changes: Changes;
}

function applyLabel(item: ReviewItem): string {
  const { change } = item;
  if (change.fieldGroup === 'price') return 'Apply price';
  if (change.fieldGroup === 'status') return change.proposed.available ? 'Make active' : 'Pause listing';
  return 'Apply';
}

function ListingName({
  listingId,
  title,
  sellerPubky,
}: {
  listingId: string;
  title: string;
  sellerPubky: string | null;
}) {
  const routeId = connectorListingRouteId(listingId);
  return routeId && sellerPubky ? (
    <Link href={getMarketplaceListingRoute(sellerPubky, routeId)} overrideDefaults className="underline">
      {title}
    </Link>
  ) : (
    <>{title}</>
  );
}

function ChangeRow({
  item,
  connection,
  changes,
  sellerPubky,
}: {
  item: ReviewItem;
  connection: MarketplaceConnectorChangesProps['connection'];
  changes: Changes;
  sellerPubky: string | null;
}) {
  const working = changes.workingId === item.change.id;
  const variantName = (listingId: string) => (variantId: string) => item.variantLabels[listingId]?.[variantId] ?? '';
  const group = item.change.fieldGroup;

  return (
    <li
      className="grid gap-3 rounded-md border border-border p-4"
      data-testid={`store-change-${group}`}
      data-state={item.state}
    >
      <Typography as="p" className="text-sm font-semibold">
        {CHANGE_HEADLINES[group]}
      </Typography>

      {item.verdicts.map(({ listingId, evaluation }) => {
        const title = item.titles[listingId] ?? listingId;
        const name = <ListingName listingId={listingId} title={title} sellerPubky={sellerPubky} />;
        if (evaluation.kind === 'apply') {
          return (
            <div key={listingId} className="grid gap-1 text-sm">
              <Typography as="p" className="text-muted-foreground">
                {name}
              </Typography>
              <ul className="grid list-disc gap-1 pl-5">
                {evaluation.changes.map((line) => (
                  <li key={describeFieldChange(line, variantName(listingId))}>
                    {describeFieldChange(line, variantName(listingId))}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (evaluation.kind === 'conflict') {
          return (
            <div key={listingId} className="grid gap-2 text-sm">
              <Typography as="p" className="text-muted-foreground">
                {name} was changed here and in your store.
              </Typography>
              <ul className="grid list-none gap-2 p-0">
                {evaluation.conflicts.map((conflict) => {
                  const text = describeConflict(conflict, variantName(listingId));
                  return (
                    <li key={text.label} className="grid gap-0.5" data-testid="store-change-conflict">
                      <span className="font-semibold">{text.label}</span>
                      <span>Yours: {text.yours}</span>
                      <span>Your store: {text.store}</span>
                    </li>
                  );
                })}
              </ul>
              {group !== 'status' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit rounded-full"
                  disabled={working}
                  onClick={() => void changes.detach(item, listingId)}
                >
                  Stop following the store for this listing
                </Button>
              )}
            </div>
          );
        }
        if (evaluation.kind === 'needs_import') {
          return (
            <Typography key={listingId} as="p" className="text-sm text-muted-foreground">
              {name}: new in your store, {newVariantsCopy(evaluation.variants)}. Import it to add it to the listing.
            </Typography>
          );
        }
        if (evaluation.kind === 'unsupported') {
          return (
            <Typography key={listingId} as="p" className="text-sm text-muted-foreground">
              {name}: {unsupportedCopy(evaluation.reason)}
            </Typography>
          );
        }
        return null;
      })}

      {item.failure && (
        <Typography as="p" role="alert" className="text-sm text-destructive" data-testid="store-change-failure">
          {CHANGE_FAILURE_COPY[item.failure]}
        </Typography>
      )}

      <div className="flex flex-wrap gap-2">
        {item.state === 'applicable' && (
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            disabled={working}
            onClick={() => void changes.apply(item)}
          >
            {working && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {applyLabel(item)}
          </Button>
        )}
        {item.state === 'conflict' && (
          <>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              disabled={working}
              onClick={() => void changes.apply(item, { takeStore: true })}
            >
              {working && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              Use the store&apos;s
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={working}
              onClick={() => void changes.dismiss(item)}
            >
              Keep mine
            </Button>
          </>
        )}
        {item.state === 'needs_import' && (
          <Button asChild size="sm" className="rounded-full">
            <Link href={getStoreConnectionCatalogRoute(connection.id)} overrideDefaults>
              <PackageSearch className="size-4" aria-hidden="true" />
              Import it
            </Link>
          </Button>
        )}
        {item.state !== 'conflict' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={working}
            onClick={() => void changes.dismiss(item)}
          >
            Dismiss
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Under a connected Shopify store: what changed in the store that waits for the seller. Store text and
 * photos apply as the page opens, so what is listed here is a price or variant change to approve, a
 * conflict to settle, a new variant to import, or a change that could not be applied and says why.
 * Renders nothing while loading and when there is nothing to review.
 */
export function MarketplaceConnectorChanges({ connection, changes }: MarketplaceConnectorChangesProps) {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const { state } = changes;

  if (state.status === 'failed') {
    return (
      <div
        role="alert"
        id={connectorChangesAnchorId(connection.id)}
        className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        data-testid="store-changes-failed"
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
          onClick={() => void changes.refresh()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }
  if (state.status !== 'ready' || (state.items.length === 0 && state.unsettled === 0 && !state.capped)) return null;

  return (
    <Card
      id={connectorChangesAnchorId(connection.id)}
      className="rounded-md p-0 shadow-lg"
      data-surface="store-changes"
      data-testid="store-changes"
    >
      <CardContent className="grid gap-4 p-6">
        <div className="grid gap-1">
          <Heading level={2} size="md">
            Shopify changes{state.items.length > 0 ? ` (${state.items.length})` : ''}
          </Heading>
          <Typography as="p" className="text-sm text-muted-foreground">
            Changes made in {connection.domain} that your listings have not taken yet. Nothing changes until you apply
            it.
          </Typography>
        </div>
        {state.unsettled > 0 && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            data-testid="store-changes-unsettled"
          >
            <span>
              {state.unsettled} {state.unsettled === 1 ? 'change' : 'changes'} could not be checked against your
              homeserver yet.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-fit rounded-full"
              onClick={() => void changes.refresh()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
        {state.capped && (
          <Typography as="p" role="status" className="text-sm text-muted-foreground" data-testid="store-changes-capped">
            More changes are waiting behind these. Apply or dismiss some, and the next ones appear here.
          </Typography>
        )}
        <ul className="grid list-none gap-3 p-0">
          {state.items.map((item) => (
            <ChangeRow
              key={item.change.id}
              item={item}
              connection={connection}
              changes={changes}
              sellerPubky={sellerPubky}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
