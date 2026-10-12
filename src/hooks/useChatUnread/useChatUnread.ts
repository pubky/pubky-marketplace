'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { ChatController } from '@/controllers/chat/chat';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * Conversations with at least one unread received message, for nav badges.
 * Read live from Dexie, so every sync and every read checkpoint refreshes it
 * in every tab. Zero renders no badge.
 */
export function useChatUnread({ enabled = true }: { enabled?: boolean } = {}): number {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  return (
    useLiveQuery(async () => {
      if (!enabled || !currentUserPubky) return 0;
      return await ChatController.getUnreadConversationCount();
    }, [enabled, currentUserPubky]) ?? 0
  );
}
