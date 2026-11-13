'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getStoreSyncEnabled, isDurableCommerceMode } from '@/config/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  connectorErrorMessage,
  type ConnectorSync,
  type ConnectorSyncDirection,
  type ConnectorSyncGroup,
  isConnectorsUnavailableError,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { SYNC_GROUP_LABELS } from '@/pipes/commerce/connector-change-copy';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

export type ConnectorSyncState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; sync: ConnectorSync }
  | { status: 'failed'; message: string };

const LOAD_FAILED = 'The sync settings could not be loaded. Try again in a moment.';

/**
 * Where each part of a connected store's products comes from: the store, or nowhere (Off). The service
 * keeps the setting and rebases it: changing a direction drops the pending changes of that group, so a
 * change reviewed under the old setting can never apply under the new one.
 */
export function useConnectorSync(connectionId: string | null, options: { onSaved?: () => void } = {}) {
  const sellerPubky = useAuthStore((auth) => auth.currentUserPubky);
  const marketplaceSession = useCommerceStore((commerce) => commerce.marketplaceSession);
  const enabled =
    getStoreSyncEnabled() &&
    isDurableCommerceMode(getCommerceAdapterMode()) &&
    Boolean(sellerPubky) &&
    connectionId !== null;
  const [state, setState] = useState<ConnectorSyncState>({ status: 'idle' });
  const [savingGroup, setSavingGroup] = useState<ConnectorSyncGroup | null>(null);

  const load = async (isCurrent: () => boolean = () => true) => {
    if (!enabled || !connectionId) return;
    setState({ status: 'loading' });
    try {
      const sync = await ConnectorsController.fetchSync(connectionId);
      if (isCurrent()) setState({ status: 'ready', sync });
    } catch (error) {
      if (!isCurrent()) return;
      setState(
        isConnectorsUnavailableError(error)
          ? { status: 'unavailable' }
          : { status: 'failed', message: connectorErrorMessage(error, LOAD_FAILED) },
      );
    }
  };

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
    // The settings load again when the inputs `load` reads change: whether sync is on, which connection, which
    // seller and which marketplace session. `load` is a render-local closure over those same values and over a
    // state setter, so listing it would reload on every render; `reload` below calls it for the Try again button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connectionId, sellerPubky, marketplaceSession]);

  const setDirection = async (group: ConnectorSyncGroup, direction: ConnectorSyncDirection): Promise<boolean> => {
    if (!connectionId || state.status !== 'ready') return false;
    setSavingGroup(group);
    try {
      const sync = await ConnectorsController.commitSync(connectionId, { [group]: direction });
      setState({ status: 'ready', sync });
      toast({
        title: `${SYNC_GROUP_LABELS[group]}: ${direction === 'from_store' ? 'from your store' : 'off'}`,
        description: 'Changes waiting in the review for this setting were cleared.',
      });
      options.onSaved?.();
      return true;
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not save this setting',
        description: connectorErrorMessage(error, 'Try again in a moment.'),
      });
      return false;
    } finally {
      setSavingGroup(null);
    }
  };

  return { state, savingGroup, setDirection, reload: () => load() };
}
