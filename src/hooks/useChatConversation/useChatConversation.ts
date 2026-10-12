'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChatOpenResult } from '@/application/chat/chat.types';
import { CHAT_THREAD_PAGE } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import type { ChatConversationView, ChatMessageView } from '@/controllers/chat/chat.types';
import { Logger } from '@/libs/logger/logger';
import type { ChatContext } from '@/models/chat/chat.schema';
import { useAuthStore } from '@/stores/auth/auth.store';

export type UseChatConversationResult = {
  conversation: ChatConversationView | null | undefined;
  messages: ChatMessageView[];
  hasMore: boolean;
  loadOlder: () => void;
  openState: ChatOpenResult['state'] | 'opening';
  reopen: () => Promise<void>;
  retryMessage: (id: string) => Promise<void>;
  isSelf: boolean;
};

/**
 * One thread: opens the conversation (creating it, probing the peer's key),
 * reads it live from Dexie, syncs it on mount and on focus, and marks it read
 * while the newest received message is on screen.
 */
export function useChatConversation(peerPubky: string, context?: ChatContext): UseChatConversationResult {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [limit, setLimit] = useState(CHAT_THREAD_PAGE);
  const [openState, setOpenState] = useState<UseChatConversationResult['openState']>('opening');
  const isSelf = currentUserPubky === peerPubky;
  const contextKey = `${context?.listingId ?? ''}|${context?.orderId ?? ''}`;

  const open = async () => {
    if (!currentUserPubky || isSelf) return;
    try {
      const result = await ChatController.commitOpenConversation(peerPubky, context);
      setOpenState(result.state);
      if (result.state === 'ready') {
        await ChatController.fetchConversationUpdates(peerPubky, 'open');
        void ChatController.commitFlushOutbox();
      }
    } catch (error) {
      Logger.warn('Chat conversation open failed', { error });
      setOpenState('peer_not_enabled');
    }
  };

  useEffect(() => {
    setOpenState('opening');
    void open();
    const onFocus = () => {
      void ChatController.fetchConversationUpdates(peerPubky, 'open').catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context identity is folded into contextKey
  }, [currentUserPubky, peerPubky, contextKey]);

  const conversation = useLiveQuery(async () => {
    if (!currentUserPubky) return null;
    return await ChatController.getConversation(peerPubky);
  }, [currentUserPubky, peerPubky]);

  const page = useLiveQuery(async () => {
    if (!currentUserPubky) return { messages: [] as ChatMessageView[], total: 0 };
    const [messages, total] = await Promise.all([
      ChatController.getMessages(peerPubky, { limit }),
      ChatController.getMessageCount(peerPubky),
    ]);
    return { messages, total };
  }, [currentUserPubky, peerPubky, limit]);

  const messages = page?.messages ?? [];
  const newestReceived = [...messages].reverse().find((row) => row.direction === 'received');

  useEffect(() => {
    if (!conversation || !newestReceived) return;
    if (newestReceived.sent_at <= conversation.last_read_at) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const timer = setTimeout(() => {
      void ChatController.commitMarkRead(peerPubky, Math.max(Date.now(), newestReceived.sent_at));
    }, 400);
    return () => clearTimeout(timer);
  }, [conversation, newestReceived, peerPubky]);

  return {
    conversation,
    messages,
    hasMore: (page?.total ?? 0) > messages.length,
    loadOlder: () => setLimit((current) => current + CHAT_THREAD_PAGE),
    openState,
    reopen: open,
    retryMessage: (id: string) => ChatController.commitRetryMessage(id),
    isSelf,
  };
}
