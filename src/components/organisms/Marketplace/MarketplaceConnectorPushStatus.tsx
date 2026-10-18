'use client';

import { AlertTriangle, CheckCircle2, LoaderCircle, RotateCcw, Store } from 'lucide-react';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import type { OrderPushRow } from '@/application/connectors/connectors';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useConnectorPushStatus } from '@/hooks/useConnectorPushStatus/useConnectorPushStatus';
import { orderAnchorId } from '@/libs/commerce/activity-links';
import {
  CONNECTOR_PROVIDER_LABELS,
  connectorAlertAction,
  connectorAlertCatalogRoute,
  connectorAlertCopy,
  connectorAlertLinkRoute,
  pushNeedsAction,
  pushStateLabel,
  quarantineReasonCopy,
} from '@/libs/commerce/connectors';

const RECENT_LIMIT = 8;

function shortId(orderId: string): string {
  return orderId.length > 8 ? orderId.slice(0, 8) : orderId;
}

function OrderLink({ orderId }: { orderId: string }) {
  return (
    <a href={`#${orderAnchorId(orderId)}`} className="font-semibold underline-offset-2 hover:underline">
      Order {shortId(orderId)}
    </a>
  );
}

function StateBadge({ row }: { row: OrderPushRow }) {
  const { push } = row;
  const className =
    push.state === 'created'
      ? 'bg-brand/20 text-brand'
      : pushNeedsAction(push)
        ? 'bg-destructive/20 text-destructive'
        : 'bg-secondary text-secondary-foreground';
  return (
    <Badge variant="secondary" className={className} data-testid="store-push-state">
      {push.state === 'created' && <CheckCircle2 aria-hidden="true" />}
      {pushStateLabel(push)}
    </Badge>
  );
}

/**
 * In the seller's Orders: which sales reached the connected store, which are
 * stuck and why, with Retry, and the store alerts that need a decision.
 * Renders nothing for a seller with no connected store.
 */
export function MarketplaceConnectorPushStatus() {
  const status = useConnectorPushStatus();
  if (!status.visible) return null;

  const recent = status.pushes.filter(({ push }) => !pushNeedsAction(push)).slice(0, RECENT_LIMIT);
  const hasIssues = status.needsAttention.length > 0 || status.alerts.length > 0;

  return (
    <Card className="rounded-md p-0 shadow-lg" data-surface="store-push-status" data-testid="store-push-status">
      <CardContent className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Store className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              Orders in your store
            </Heading>
          </div>
          <Button asChild variant="secondary" size="sm" className="rounded-full">
            <Link href={MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS} overrideDefaults>
              Store connections
            </Link>
          </Button>
        </div>

        {hasIssues && (
          <ul className="grid list-none gap-3 p-0" data-testid="store-push-attention">
            {status.needsAttention.map((row) => (
              <li
                key={row.push.id}
                className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid="store-push-quarantined"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="grid gap-1 text-sm">
                    <Typography as="p">
                      <OrderLink orderId={row.push.pubkyOrderId} />
                      <span className="text-muted-foreground"> was not sent to {row.connection.domain}.</span>
                    </Typography>
                    <Typography as="p" className="text-muted-foreground">
                      {quarantineReasonCopy(row.push.quarantineReason)}
                    </Typography>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 rounded-full"
                  disabled={status.retryingOrderId === row.push.pubkyOrderId}
                  onClick={() => void status.retry(row)}
                >
                  {status.retryingOrderId === row.push.pubkyOrderId ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="size-4" aria-hidden="true" />
                  )}
                  Retry
                </Button>
              </li>
            ))}
            {status.alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-col gap-3 rounded-md border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid="store-push-alert"
              >
                <div className="grid gap-1 text-sm">
                  {alert.pubkyOrderId && (
                    <Typography as="p">
                      <OrderLink orderId={alert.pubkyOrderId} />
                    </Typography>
                  )}
                  <Typography as="p" className="text-muted-foreground">
                    {connectorAlertCopy(alert.kind)}
                  </Typography>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {connectorAlertAction(alert) && (
                    <Button asChild size="sm" className="rounded-full" data-testid="store-push-alert-action">
                      <a href={`#${orderAnchorId(connectorAlertAction(alert)?.orderId ?? '')}`}>
                        {connectorAlertAction(alert)?.label}
                      </a>
                    </Button>
                  )}
                  {connectorAlertLinkRoute(alert) && (
                    <Button asChild size="sm" className="rounded-full" data-testid="store-push-alert-link">
                      <Link href={connectorAlertLinkRoute(alert) ?? ''} overrideDefaults>
                        Link listing
                      </Link>
                    </Button>
                  )}
                  {connectorAlertCatalogRoute(alert) && (
                    <Button asChild size="sm" className="rounded-full" data-testid="store-push-alert-catalog">
                      <Link href={connectorAlertCatalogRoute(alert) ?? ''} overrideDefaults>
                        Open the catalog
                      </Link>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    onClick={() => void status.dismissAlert(alert.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {recent.length > 0 ? (
          <ul className="grid list-none gap-2 p-0" data-testid="store-push-recent">
            {recent.map((row) => (
              <li
                key={row.push.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
                data-testid="store-push-row"
              >
                <span className="min-w-0">
                  <OrderLink orderId={row.push.pubkyOrderId} />
                  <span className="text-muted-foreground">
                    {' '}
                    in {row.connection.domain} ({CONNECTOR_PROVIDER_LABELS[row.push.provider]}
                    {row.push.externalId ? `, #${row.push.externalId}` : ''})
                  </span>
                </span>
                <StateBadge row={row} />
              </li>
            ))}
          </ul>
        ) : (
          !hasIssues && (
            <Typography as="p" className="text-sm text-muted-foreground" data-testid="store-push-empty">
              Paid Pubky orders will appear here once they reach your store.
            </Typography>
          )
        )}
      </CardContent>
    </Card>
  );
}
