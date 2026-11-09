'use client';

import { ExternalLink } from 'lucide-react';
import { Switch } from '@/atoms/Switch/Switch';
import { Typography } from '@/atoms/Typography/Typography';
import type { ListingGroupSync } from '@/hooks/useListingStoreSync/useListingStoreSync';
import type { ConnectorSyncGroup } from '@/libs/commerce/connectors';
import { SYNC_GROUP_LABELS } from '@/pipes/commerce/connector-change-copy';

export interface MarketplaceListingStoreFollowProps {
  group: ConnectorSyncGroup;
  /** The store the listing is linked to, as the seller knows it (`demo.myshopify.com`). */
  domain: string;
  state: ListingGroupSync;
  /** The store's page for the linked product, where the fields that follow it are edited. */
  editInStoreUrl: string | null;
  saving: boolean;
  onToggle: () => void;
}

/**
 * A listing's own setting for one part of its store sync, in the editor: it follows the connection
 * (the fields are shown read-only, with a way to edit them in the store) or it is overridden for this
 * listing alone. A part the connection leaves alone and the listing does not override shows nothing.
 */
export function MarketplaceListingStoreFollow({
  group,
  domain,
  state,
  editInStoreUrl,
  saving,
  onToggle,
}: MarketplaceListingStoreFollowProps) {
  if (!state.follows && !state.overridden) return null;
  const label = SYNC_GROUP_LABELS[group];
  const switchId = `store-follow-${group}`;

  return (
    <div
      className="flex items-start justify-between gap-4 rounded-md border border-dashed border-border p-3"
      data-testid={`store-follow-${group}`}
      data-follows={state.follows}
    >
      <div className="grid gap-1">
        <Typography as="label" htmlFor={switchId} className="text-sm font-semibold">
          {state.follows ? `${label} follow ${domain}` : `${label} are set for this listing`}
        </Typography>
        <Typography as="p" className="text-xs text-muted-foreground">
          {state.follows ? (
            <>
              They are read-only here, so a change in your store never collides with one made here.{' '}
              {editInStoreUrl && (
                <a
                  href={editInStoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Edit in Shopify
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}{' '}
              Or turn this off to edit them here.
            </>
          ) : (
            <>Changes made in your store are not applied to them. Turn this on to follow the connection again.</>
          )}
        </Typography>
      </div>
      <Switch
        id={switchId}
        checked={!state.overridden}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label={`${label} follow the connection`}
      />
    </div>
  );
}
