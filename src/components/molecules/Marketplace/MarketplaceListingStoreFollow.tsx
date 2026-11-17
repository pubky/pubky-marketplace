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
 * A listing's own setting for one part of its store sync, in the editor. On, the part follows the store:
 * its fields are read-only, with a way to edit them in the store. Off, the part is not synced for this
 * listing. The switch always shows what applies to the listing (`follows`); whether that is the connection's
 * setting or the listing's own is said in the line under it.
 */
export function MarketplaceListingStoreFollow({
  group,
  domain,
  state,
  editInStoreUrl,
  saving,
  onToggle,
}: MarketplaceListingStoreFollowProps) {
  const label = SYNC_GROUP_LABELS[group];
  const switchId = `store-follow-${group}-${domain}`;
  const own = state.overridden ? 'Set for this listing only.' : 'Set for the whole connection.';

  return (
    <div
      className="flex items-start justify-between gap-4 rounded-md border border-dashed border-border p-3"
      data-testid={`store-follow-${group}`}
      data-follows={state.follows}
    >
      <div className="grid gap-1">
        <Typography as="label" htmlFor={switchId} className="text-sm font-semibold">
          {label}: {state.follows ? `follow ${domain}` : `not synced with ${domain}`}
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
              Or turn this off to edit them here. {own}
            </>
          ) : (
            <>Changes made in your store are not applied to them. Turn this on to follow your store. {own}</>
          )}
        </Typography>
      </div>
      <Switch
        id={switchId}
        checked={state.follows}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label={`${label} follow ${domain}`}
      />
    </div>
  );
}
