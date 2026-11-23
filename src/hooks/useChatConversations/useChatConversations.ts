'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { ChatController } from '@/controllers/chat/chat';
import type { ChatConversationView } from '@/controllers/chat/chat.types';
import { useStoreThreadRoles } from '@/hooks/useStoreThreadRoles/useStoreThreadRoles';
import { useAuthStore } from '@/stores/auth/auth.store';

export type UseChatConversationsResult = {
  conversations: ChatConversationView[];
  isLoading: boolean;
  isSignedIn: boolean;
};

/** The inbox list, live from Dexie, newest activity first. */
export function useChatConversations(): UseChatConversationsResult {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const storeThreadRoles = useStoreThreadRoles();
  const conversations = useLiveQuery(async () => {
    if (!currentUserPubky) return [];
    return await ChatController.getConversations();
  }, [currentUserPubky, storeThreadRoles]);
  return {
    conversations: conversations ?? [],
    isLoading: conversations === undefined && Boolean(currentUserPubky),
    isSignedIn: Boolean(currentUserPubky),
  };
}
