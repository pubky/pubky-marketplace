'use client';

import { useEffect } from 'react';
import { ChatController } from '@/controllers/chat/chat';
import { Logger } from '@/libs/logger/logger';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';

/**
 * Makes sure the signed-in account has its chat key, and reports whether the
 * session can use chat at all (`needs_reauth` = the grant lacks the chat scopes).
 */
export function useChatIdentity() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const identityState = useChatStore((state) => state.identityState);
  const inboxStatus = useChatStore((state) => state.inboxStatus);

  useEffect(() => {
    if (!currentUserPubky) return;
    void ChatController.getOrFetchIdentity().catch((error: unknown) => {
      Logger.warn('Chat identity check failed', { error });
    });
  }, [currentUserPubky]);

  const retry = async () => {
    try {
      await ChatController.getOrFetchIdentity();
    } catch (error) {
      Logger.warn('Chat identity retry failed', { error });
    }
  };

  return { identityState, inboxStatus, retry };
}
