'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getStoreConnectionsEnabled, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  type ConnectionHealth,
  connectionHealth,
  type ConnectorAlert,
  type ConnectorConnection,
  connectorErrorMessage,
  connectorRefusalReason,
  type ConnectorUnmappedListing,
  type VariantMode,
} from '@/libs/commerce/connectors';
import { isMarketplaceSessionRequiredError } from '@/libs/error/error.utils';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/** Listings a switch to one listing per variant unlinked, kept until the seller dismisses them. */
export type UnmappedListingsNotice = {
  connectionId: string;
  domain: string;
  listings: ConnectorUnmappedListing[];
};

export type StoreConnectionRow = {
  connection: ConnectorConnection;
  health: ConnectionHealth;
};

/**
 * Alerts that say a connection is gone; the service omits such a connection from
 * its list. A connection whose keys were rejected stays listed with status
 * `error`, so its card already says it needs attention.
 */
const CONNECTION_LOST_ALERTS: ReadonlySet<string> = new Set(['store_uninstalled']);

const LOAD_FAILED_COPY = 'Your store connections could not be loaded. Try again in a moment.';

/**
 * The seller's store connections with their health, plus Disconnect. A
 * connection disconnected in this visit stays in the list as Disconnected (with
 * the reminder to revoke access on the store) until the page is reloaded,
 * because the service stops listing it.
 */
export function useStoreConnections() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const enabled =
    getStoreConnectionsEnabled() && isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(currentUserPubky);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [disconnected, setDisconnected] = useState<ConnectorConnection[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [needsSession, setNeedsSession] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [lostAlerts, setLostAlerts] = useState<ConnectorAlert[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedListingsNotice | null>(null);

  const load = async (isCurrent: () => boolean = () => true) => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    try {
      const next = await ConnectorsController.fetchConnections();
      if (!isCurrent()) return;
      setConnections(next);
      const alerts = await ConnectorsController.fetchAlerts().catch(() => []);
      if (!isCurrent()) return;
      setLostAlerts(alerts.filter((alert) => CONNECTION_LOST_ALERTS.has(alert.kind)));
      setError(null);
      setNeedsSession(false);
      setUnavailable(false);
    } catch (loadError) {
      if (!isCurrent()) return;
      const reason = connectorRefusalReason(loadError);
      setNeedsSession(isMarketplaceSessionRequiredError(loadError));
      setUnavailable(reason === 'connectors_disabled');
      setError(connectorErrorMessage(loadError, LOAD_FAILED_COPY));
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentUserPubky, marketplaceSession]);

  const refresh = async () => {
    await load();
  };

  const disconnect = async (connection: ConnectorConnection): Promise<boolean> => {
    setWorkingId(connection.id);
    try {
      await ConnectorsController.commitDisconnect(connection.id);
      setConnections((current) => current.filter((entry) => entry.id !== connection.id));
      setDisconnected((current) => [...current.filter((entry) => entry.id !== connection.id), connection]);
      toast({ description: 'Disconnected. Pubky deleted its keys for this store.' });
      return true;
    } catch (disconnectError) {
      toast({
        variant: 'error',
        title: 'Could not disconnect',
        description: connectorErrorMessage(disconnectError, 'The connection is still active. Try again in a moment.'),
      });
      return false;
    } finally {
      setWorkingId(null);
    }
  };

  const dismissLostAlert = async (alertId: string): Promise<void> => {
    try {
      await ConnectorsController.commitResolveAlert(alertId);
      setLostAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (dismissError) {
      toast({
        variant: 'error',
        title: 'Could not dismiss',
        description: connectorErrorMessage(dismissError, 'Try again in a moment.'),
      });
    }
  };

  const setVariantMode = async (connection: ConnectorConnection, variantMode: VariantMode): Promise<boolean> => {
    setWorkingId(connection.id);
    try {
      const { connection: updated, unmappedListings } = await ConnectorsController.commitVariantMode(
        connection.id,
        variantMode,
      );
      setConnections((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setUnmapped(
        unmappedListings.length > 0
          ? { connectionId: updated.id, domain: updated.domain, listings: unmappedListings }
          : null,
      );
      toast({ description: 'Setting saved. It applies to products you publish from now on.' });
      return true;
    } catch (modeError) {
      toast({
        variant: 'error',
        title: 'Could not change the setting',
        description: connectorErrorMessage(modeError, 'The setting is unchanged. Try again in a moment.'),
      });
      return false;
    } finally {
      setWorkingId(null);
    }
  };

  const rows: StoreConnectionRow[] = [
    ...connections.map((connection) => ({ connection, health: connectionHealth(connection) })),
    ...disconnected.map((connection) => ({
      connection,
      health: connectionHealth(connection, { disconnectedLocally: true }),
    })),
  ];

  return {
    enabled,
    rows,
    connections,
    lostAlerts,
    unmapped,
    dismissUnmapped: () => setUnmapped(null),
    isLoading,
    error,
    needsSession,
    unavailable,
    workingId,
    refresh,
    disconnect,
    setVariantMode,
    dismissLostAlert,
  };
}
