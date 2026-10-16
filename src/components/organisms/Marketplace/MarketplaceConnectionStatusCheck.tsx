'use client';

import { AlertTriangle, CheckCircle2, Clock, LoaderCircle, RefreshCw } from 'lucide-react';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
import type { ConnectionCheck } from '@/application/connectors/connectors';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import type { StatusCheckPhase } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';

type MarketplaceConnectionStatusCheckProps = {
  phase: StatusCheckPhase;
  result: ConnectionCheck | null;
  onCheck: () => void;
  /** Words for the idle and waiting states, for example "Shopify" or "WooCommerce". */
  storeLabel: string;
};

/**
 * The status check shown after connecting: the store's name, the permissions it
 * granted and how many products are ready to choose from, or what is wrong.
 */
export function MarketplaceConnectionStatusCheck({
  phase,
  result,
  onCheck,
  storeLabel,
}: MarketplaceConnectionStatusCheckProps) {
  const connection = result?.connection ?? null;

  if (phase === 'checking') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="status-check">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Checking your {storeLabel} connection.
      </div>
    );
  }

  if (phase === 'connected' && connection) {
    const permissions = result?.store?.grantedScopes ?? connection.scopes;
    const store = result?.store ?? null;
    return (
      <div className="grid gap-3" role="status" data-testid="status-check" data-phase="connected">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 shrink-0 text-brand" aria-hidden="true" />
          <Typography as="p" className="font-semibold">
            Connected to {store?.shopName ?? connection.domain}
          </Typography>
        </div>
        <ul className="grid list-disc gap-1 pl-7 text-sm text-muted-foreground">
          {permissions.length > 0 && <li>Permissions granted: {permissions.join(', ')}</li>}
          {typeof store?.locationCount === 'number' && (
            <li>
              {store.locationCount} {store.locationCount === 1 ? 'location' : 'locations'}
            </li>
          )}
          <li>
            {result?.productCount && result.productCount > 0
              ? `${result.productCount} ${result.productCount === 1 ? 'product is' : 'products are'} ready to import.`
              : 'No products found in your store yet.'}
          </li>
        </ul>
        <Button asChild className="w-fit rounded-full">
          <Link href={getStoreConnectionCatalogRoute(connection.id)} overrideDefaults>
            Choose products
          </Link>
        </Button>
      </div>
    );
  }

  if (phase === 'attention') {
    return (
      <div className="grid gap-3" role="alert" data-testid="status-check" data-phase="attention">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="grid gap-1 text-sm">
            <Typography as="p" className="font-semibold">
              This connection needs attention
            </Typography>
            {result?.health?.reasons.map((reason) => (
              <Typography as="p" key={reason} className="text-muted-foreground">
                {reason}
              </Typography>
            ))}
            {result && result.health?.reasons.length === 0 && !result.catalogReadable && (
              <Typography as="p" className="text-muted-foreground">
                Connected, but your product list could not be read. Check again in a moment.
              </Typography>
            )}
          </div>
        </div>
        <Button type="button" variant="secondary" className="w-fit rounded-full" onClick={onCheck}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Check again
        </Button>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="grid gap-3" role="status" data-testid="status-check" data-phase="waiting">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Typography as="p" className="text-muted-foreground">
            {storeLabel} has not confirmed the connection yet. This can take a minute after you approve it.
          </Typography>
        </div>
        <Button type="button" variant="secondary" className="w-fit rounded-full" onClick={onCheck}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Check again
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-fit rounded-full"
      onClick={onCheck}
      data-testid="status-check"
    >
      <RefreshCw className="size-4" aria-hidden="true" />
      Check connection
    </Button>
  );
}
