'use client';

import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import type { useConnectorSync } from '@/hooks/useConnectorSync/useConnectorSync';
import {
  CONNECTOR_SYNC_DIRECTIONS,
  type ConnectorConnection,
  type ConnectorSyncDirection,
} from '@/libs/commerce/connectors';
import { SYNC_GROUP_HELP, SYNC_GROUP_LABELS } from '@/pipes/commerce/connector-change-copy';

const DIRECTION_LABELS: Readonly<Record<ConnectorSyncDirection, string>> = {
  from_store: 'From your store',
  off: 'Off',
};

export interface MarketplaceConnectorSyncSettingsProps {
  connection: Pick<ConnectorConnection, 'id' | 'domain'>;
  sync: ReturnType<typeof useConnectorSync>;
}

/**
 * The Sync table of a connected store: for each part of a product, whether the listing follows the store
 * or is left alone. Stock is not here: it always follows the store. A listing can override a row from
 * its own edit page. Renders nothing until the settings load, and on a server with no store connections.
 */
export function MarketplaceConnectorSyncSettings({ connection, sync }: MarketplaceConnectorSyncSettingsProps) {
  if (sync.state.status !== 'ready') return null;
  const { groups } = sync.state.sync;

  return (
    <Card className="rounded-md p-0" data-surface="store-sync" data-testid="store-sync">
      <CardContent className="grid gap-4 p-6">
        <div className="grid gap-1">
          <Heading level={2} size="md">
            Sync with {connection.domain}
          </Heading>
          <Typography as="p" className="text-sm text-muted-foreground">
            Choose where each part of your linked listings comes from. Stock always follows your store.
          </Typography>
        </div>
        <ul className="grid list-none gap-3 p-0">
          {groups.map((group) => (
            <li
              key={group.fieldGroup}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center"
              data-testid={`store-sync-${group.fieldGroup}`}
            >
              <div className="grid gap-0.5">
                <Typography as="p" className="text-sm font-semibold">
                  {SYNC_GROUP_LABELS[group.fieldGroup]}
                </Typography>
                <Typography as="p" className="text-xs text-muted-foreground">
                  {group.direction === 'from_store' ? SYNC_GROUP_HELP[group.fieldGroup] : 'Not synced.'}
                </Typography>
              </div>
              <Select
                value={group.direction}
                disabled={sync.savingGroup !== null}
                onValueChange={(next) => void sync.setDirection(group.fieldGroup, next as ConnectorSyncDirection)}
              >
                <SelectTrigger theme="secondary" className="w-full" aria-label={SYNC_GROUP_LABELS[group.fieldGroup]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTOR_SYNC_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction} value={direction}>
                      {DIRECTION_LABELS[direction]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
        <Typography as="p" className="text-xs text-muted-foreground">
          A product your store stops selling always pauses its listing, whatever these say, because an order for it
          could not reach your store.
        </Typography>
      </CardContent>
    </Card>
  );
}
