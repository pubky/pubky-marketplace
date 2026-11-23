'use client';

import { useLayoutEffect, useState } from 'react';
import { buildFeatureDiscoveryStorageKey, DELIVERY_KEY_CUSTODY_NOTICE_STORAGE_ID } from '@/config/featureDiscovery';
import { useAuthStore } from '@/stores/auth/auth.store';

interface NoticeState {
  pubky: string | null;
  dismissed: boolean;
  hydrated: boolean;
}

/**
 * Per-account dismissal of the delivery key notice, persisted through the feature-discovery
 * localStorage keys like the chat privacy note, so signing the account out of this browser
 * forgets it. The notice is hidden until the stored state has been read so a dismissed notice
 * never flashes.
 */
export function useDeliveryKeyCustodyNotice() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [state, setState] = useState<NoticeState>({ pubky: null, dismissed: false, hydrated: false });

  useLayoutEffect(() => {
    if (!currentUserPubky) {
      setState({ pubky: null, dismissed: true, hydrated: true });
      return;
    }
    try {
      const key = buildFeatureDiscoveryStorageKey(currentUserPubky, DELIVERY_KEY_CUSTODY_NOTICE_STORAGE_ID);
      setState({
        pubky: currentUserPubky,
        dismissed: window.localStorage.getItem(key) === 'dismissed',
        hydrated: true,
      });
    } catch {
      setState({ pubky: currentUserPubky, dismissed: false, hydrated: true });
    }
  }, [currentUserPubky]);

  const resolved = state.hydrated && state.pubky === (currentUserPubky ?? null);
  const showNotice = resolved && !state.dismissed;

  const dismissNotice = () => {
    if (!showNotice || !currentUserPubky) return;
    setState({ pubky: currentUserPubky, dismissed: true, hydrated: true });
    try {
      window.localStorage.setItem(
        buildFeatureDiscoveryStorageKey(currentUserPubky, DELIVERY_KEY_CUSTODY_NOTICE_STORAGE_ID),
        'dismissed',
      );
    } catch {
      // The in-memory state already hides the notice for this session.
    }
  };

  return { showNotice, dismissNotice };
}
