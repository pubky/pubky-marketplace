'use client';

import { useEffect, useState } from 'react';
import type { OrderPushRow, StorePushOverview } from '@/application/connectors/connectors';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  type ConnectorAlert,
  connectorErrorMessage,
  connectorRefusalReason,
  pushNeedsAction,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

const POLL_MS = 30_000;

const RETRY_REFUSALS: Readonly<Record<string, string>> = {
  not_retryable: 'This order is not waiting for a retry any more.',
  already_created: 'This order is already in your store.',
  push_not_found: 'This order is no longer in the list.',
  connection_not_connected: 'This connection is not active. Reconnect it in Store connections, then retry.',
};

/**
 * Which orders reached the seller's connected stores, which did not, and the
 * unresolved alerts. Pushes keep running while a store needs attention, so every
 * listed connection that is not a draft counts. Hidden (`visible` false) when
 * the seller has no such store, no alert, or the service has store connections switched off, so the orders page
 * is unchanged for everyone else.
 */
export function useConnectorPushStatus() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const enabled = isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(currentUserPubky);
  const [overview, setOverview] = useState<StorePushOverview | null>(null);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);

  const load = async (isCurrent: () => boolean = () => true) => {
    try {
      const next = await ConnectorsController.fetchPushOverview();
      if (isCurrent()) setOverview(next);
    } catch {
      if (isCurrent()) setOverview(null);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [enabled, currentUserPubky, marketplaceSession]);

  const inFlight = overview?.pushes.some(({ push }) => push.state === 'pending' || push.state === 'sending') ?? false;

  useEffect(() => {
    if (!enabled || !inFlight) return;
    let current = true;
    const timer = setInterval(() => void load(() => current), POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [enabled, inFlight]);

  const needsAttention = overview?.pushes.filter(({ push }) => pushNeedsAction(push)) ?? [];
  const alertsWithoutPush: ConnectorAlert[] = (overview?.alerts ?? []).filter(
    (alert) =>
      !(
        alert.kind === 'push_quarantined' &&
        alert.pubkyOrderId &&
        needsAttention.some(({ push }) => push.pubkyOrderId === alert.pubkyOrderId)
      ),
  );

  const retry = async (row: OrderPushRow): Promise<boolean> => {
    setRetryingOrderId(row.push.pubkyOrderId);
    try {
      const push = await ConnectorsController.commitRetryPush(row.connection.id, row.push.pubkyOrderId);
      setOverview((current) =>
        current
          ? {
              ...current,
              pushes: current.pushes.map((entry) =>
                entry.push.id === push.id ? { connection: entry.connection, push } : entry,
              ),
            }
          : current,
      );
      toast({ description: 'Sending this order to your store again.' });
      return true;
    } catch (error) {
      const reason = connectorRefusalReason(error);
      toast({
        variant: 'error',
        title: 'Could not retry',
        description:
          (reason && RETRY_REFUSALS[reason]) ??
          connectorErrorMessage(error, 'The order was not sent again. Try again in a moment.'),
      });
      return false;
    } finally {
      setRetryingOrderId(null);
    }
  };

  const dismissAlert = async (alertId: string): Promise<boolean> => {
    try {
      await ConnectorsController.commitResolveAlert(alertId);
      setOverview((current) =>
        current ? { ...current, alerts: current.alerts.filter((alert) => alert.id !== alertId) } : current,
      );
      return true;
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not dismiss',
        description: connectorErrorMessage(error, 'Try again in a moment.'),
      });
      return false;
    }
  };

  return {
    visible: (overview?.connections.length ?? 0) > 0 || (overview?.alerts.length ?? 0) > 0,
    connections: overview?.connections ?? [],
    pushes: overview?.pushes ?? [],
    needsAttention,
    alerts: alertsWithoutPush,
    retryingOrderId,
    retry,
    dismissAlert,
    refresh: async () => load(),
  };
}
