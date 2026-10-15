'use client';

import { useLayoutEffect, useState } from 'react';
import { buildFeatureDiscoveryStorageKey, CHAT_PRIVACY_NOTE_STORAGE_ID } from '@/config/featureDiscovery';
import { useAuthStore } from '@/stores/auth/auth.store';

interface NoteState {
  pubky: string | null;
  dismissed: boolean;
  hydrated: boolean;
}

/**
 * Per-account dismissal of the chat privacy note, persisted through the
 * feature-discovery localStorage keys like the marketplace promo. The note is
 * hidden until the stored state has been read so a dismissed note never
 * flashes; a signed-out viewer never sees it (there is no composer either).
 */
export function useChatPrivacyNote() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [state, setState] = useState<NoteState>({ pubky: null, dismissed: false, hydrated: false });

  useLayoutEffect(() => {
    if (!currentUserPubky) {
      setState({ pubky: null, dismissed: true, hydrated: true });
      return;
    }
    try {
      const key = buildFeatureDiscoveryStorageKey(currentUserPubky, CHAT_PRIVACY_NOTE_STORAGE_ID);
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
  const showNote = resolved && !state.dismissed;

  const dismissNote = () => {
    if (!showNote || !currentUserPubky) return;
    setState({ pubky: currentUserPubky, dismissed: true, hydrated: true });
    try {
      window.localStorage.setItem(
        buildFeatureDiscoveryStorageKey(currentUserPubky, CHAT_PRIVACY_NOTE_STORAGE_ID),
        'dismissed',
      );
    } catch {
      // The in-memory state already hides the note for this session.
    }
  };

  return { showNote, dismissNote };
}
