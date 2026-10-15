'use client';

import { useState } from 'react';
import { KeyRound, LoaderCircle, PackageSearch, Unplug } from 'lucide-react';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/atoms/Dialog/Dialog';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useReplaceStoreCredentials } from '@/hooks/useReplaceStoreCredentials/useReplaceStoreCredentials';
import type { StoreConnectionRow } from '@/hooks/useStoreConnections/useStoreConnections';
import {
  CONNECTION_STATE_LABELS,
  type ConnectionState,
  CONNECTOR_PROVIDER_LABELS,
  type ConnectorConnection,
} from '@/libs/commerce/connectors';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';

type MarketplaceStoreConnectionListProps = {
  rows: readonly StoreConnectionRow[];
  workingId: string | null;
  onDisconnect: (connection: ConnectorConnection) => Promise<boolean>;
  /** Runs after keys were replaced, so the page can check the connection again. */
  onReplaced: (connection: ConnectorConnection) => void | Promise<void>;
};

const STATE_BADGE_CLASSES: Readonly<Record<ConnectionState, string>> = {
  connected: 'bg-brand/20 text-brand',
  needs_attention: 'bg-destructive/20 text-destructive',
  connecting: 'bg-secondary text-secondary-foreground',
  disconnected: 'bg-secondary text-muted-foreground',
};

const REVOKE_REMINDER: Readonly<Record<ConnectorConnection['provider'], string>> = {
  shopify: 'Also uninstall the app in Shopify to revoke it there.',
  woocommerce: 'Also delete the key in WooCommerce under Settings, Advanced, REST API to revoke it there.',
};

const CREDENTIAL_LABELS: Readonly<Record<ConnectorConnection['provider'], [string, string]>> = {
  shopify: ['Client ID', 'Client secret'],
  woocommerce: ['Consumer key', 'Consumer secret'],
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function ReplaceCredentialsDialog({
  connection,
  open,
  onOpenChange,
  onReplaced,
}: {
  connection: ConnectorConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplaced: () => void | Promise<void>;
}) {
  const replace = useReplaceStoreCredentials(connection, async () => {
    onOpenChange(false);
    await onReplaced();
  });
  const [firstLabel, secondLabel] = CREDENTIAL_LABELS[connection.provider];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) replace.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace credentials</DialogTitle>
          <DialogDescription>
            Paste the new {firstLabel} and {secondLabel} for {connection.domain}. They are sent securely to Pubky and
            stored encrypted, and replace the old pair. Pubky never shows them again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          data-testid="replace-credentials-form"
          onSubmit={(event) => {
            event.preventDefault();
            void replace.submit();
          }}
        >
          <ControlledInputField
            name="first"
            control={replace.form.control}
            label={firstLabel}
            type="password"
            autoComplete="off"
          />
          <ControlledInputField
            name="second"
            control={replace.form.control}
            label={secondLabel}
            type="password"
            autoComplete="off"
          />
          <DialogFooter>
            <Button type="button" variant="secondary" className="rounded-full" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={replace.isWorking}>
              {replace.isWorking && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              Replace credentials
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DisconnectDialog({
  connection,
  open,
  onOpenChange,
  working,
  onConfirm,
}: {
  connection: ConnectorConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  working: boolean;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {connection.domain}?</DialogTitle>
          <DialogDescription>
            Pubky deletes its keys for this store straight away and stops sending orders to it. Your Pubky listings stay
            as they are, but their stock no longer follows your store. {REVOKE_REMINDER[connection.provider]}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" className="rounded-full" onClick={() => onOpenChange(false)}>
            Keep connected
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-full"
            disabled={working}
            onClick={() => void onConfirm()}
          >
            {working && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionCard({
  row,
  working,
  onDisconnect,
  onReplaced,
}: {
  row: StoreConnectionRow;
  working: boolean;
  onDisconnect: MarketplaceStoreConnectionListProps['onDisconnect'];
  onReplaced: MarketplaceStoreConnectionListProps['onReplaced'];
}) {
  const { connection, health } = row;
  const [replacing, setReplacing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const store = CONNECTOR_PROVIDER_LABELS[connection.provider];
  const connectedOn = formatDate(connection.connectedAt);
  const sent = connection.pushes.created;
  const canBrowse = connection.status === 'connected' && health.state !== 'disconnected';

  return (
    <Card className="rounded-md p-0" data-testid="store-connection" data-state={health.state}>
      <CardContent className="grid gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level={3} size="md">
                {connection.domain}
              </Heading>
              <Badge
                variant="secondary"
                className={STATE_BADGE_CLASSES[health.state]}
                data-testid="store-connection-state"
              >
                {CONNECTION_STATE_LABELS[health.state]}
              </Badge>
            </div>
            <Typography as="p" className="text-sm text-muted-foreground">
              {store}
              {connectedOn ? `, connected ${connectedOn}` : ''}
            </Typography>
          </div>
        </div>

        {health.state === 'needs_attention' && (
          <ul className="grid gap-1 text-sm" data-testid="store-connection-reasons">
            {health.reasons.map((reason) => (
              <li key={reason} className="text-destructive">
                {reason}
              </li>
            ))}
          </ul>
        )}

        {health.state === 'connecting' && (
          <Typography as="p" className="text-sm text-muted-foreground">
            This connection is not finished. Use the guide below to complete it.
          </Typography>
        )}

        {health.state === 'disconnected' && (
          <Typography as="p" className="text-sm text-muted-foreground" data-testid="store-connection-disconnected">
            Disconnected. Pubky deleted its keys for this store. {REVOKE_REMINDER[connection.provider]}
          </Typography>
        )}

        {(health.state === 'connected' || health.state === 'needs_attention') && (
          <Typography as="p" className="text-sm text-muted-foreground" data-testid="store-connection-counts">
            {connection.mappingCount} {connection.mappingCount === 1 ? 'product' : 'products'} linked, {sent}{' '}
            {sent === 1 ? 'order' : 'orders'} sent to your store
            {connection.pushes.pending + connection.pushes.sending > 0
              ? `, ${connection.pushes.pending + connection.pushes.sending} on the way`
              : ''}
            .
          </Typography>
        )}

        {health.state !== 'disconnected' && (
          <div className="flex flex-wrap gap-2">
            {canBrowse && (
              <Button asChild size="sm" className="rounded-full">
                <Link href={getStoreConnectionCatalogRoute(connection.id)} overrideDefaults>
                  <PackageSearch className="size-4" aria-hidden="true" />
                  Choose products
                </Link>
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => setReplacing(true)}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              Replace credentials
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={working}
              onClick={() => setDisconnecting(true)}
            >
              <Unplug className="size-4" aria-hidden="true" />
              Disconnect
            </Button>
          </div>
        )}

        <ReplaceCredentialsDialog
          connection={connection}
          open={replacing}
          onOpenChange={setReplacing}
          onReplaced={() => onReplaced(connection)}
        />
        <DisconnectDialog
          connection={connection}
          open={disconnecting}
          onOpenChange={setDisconnecting}
          working={working}
          onConfirm={async () => {
            if (await onDisconnect(connection)) setDisconnecting(false);
          }}
        />
      </CardContent>
    </Card>
  );
}

/** The seller's store connections: health, reason, Replace credentials and Disconnect. */
export function MarketplaceStoreConnectionList({
  rows,
  workingId,
  onDisconnect,
  onReplaced,
}: MarketplaceStoreConnectionListProps) {
  return (
    <div className="grid gap-4" data-surface="store-connections" data-testid="store-connection-list">
      {rows.map((row) => (
        <ConnectionCard
          key={row.connection.id}
          row={row}
          working={workingId === row.connection.id}
          onDisconnect={onDisconnect}
          onReplaced={onReplaced}
        />
      ))}
    </div>
  );
}
