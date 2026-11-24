'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChatOpenResult } from '@/application/chat/chat.types';
import { CHAT_OPEN_THREAD_POLL_MS, CHAT_THREAD_PAGE } from '@/config/chat';
import { ChatController, isStoreThreadRefusal } from '@/controllers/chat/chat';
import type { ChatMessageView } from '@/controllers/chat/chat.types';
import { useStoreThreadRoles } from '@/hooks/useStoreThreadRoles/useStoreThreadRoles';
import { isAbortError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import type { ChatContext } from '@/models/chat/chat.schema';
import { useAuthStore } from '@/stores/auth/auth.store';

export type UseChatConversationResult = {
  messages: ChatMessageView[];
  hasMore: boolean;
  loadOlder: () => void;
  openState: ChatOpenResult['state'] | 'opening' | 'store_restricted';
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
  const storeThreadRoles = useStoreThreadRoles();
  const [limit, setLimit] = useState(CHAT_THREAD_PAGE);
  const [openState, setOpenState] = useState<UseChatConversationResult['openState']>('opening');
  const openStateRef = useRef(openState);
  const openRun = useRef(0);
  const rolesSeen = useRef(false);
  const isSelf = currentUserPubky === peerPubky;
  const contextKey = `${context?.listingId ?? ''}|${context?.orderId ?? ''}`;
  const updateOpenState = (state: UseChatConversationResult['openState']) => {
    openStateRef.current = state;
    setOpenState(state);
  };

  const open = async () => {
    if (!currentUserPubky || isSelf) return;
    const run = ++openRun.current;
    try {
      const result = await ChatController.commitOpenConversation(peerPubky, context);
      if (run !== openRun.current) return;
      updateOpenState(result.state);
      if (result.state === 'ready') {
        await ChatController.fetchConversationUpdates(peerPubky, 'open');
        void ChatController.commitFlushOutbox();
      }
    } catch (error) {
      if (isAbortError(error) || run !== openRun.current) return;
      if (isStoreThreadRefusal(error)) {
        updateOpenState('store_restricted');
        return;
      }
      Logger.warn('Chat conversation open failed', { error });
      updateOpenState('peer_not_enabled');
    }
  };

  const retryMessage = async (id: string) => {
    try {
      await ChatController.commitRetryMessage(id);
    } catch (error) {
      if (!isAbortError(error)) throw error;
    }
  };

  useEffect(() => {
    updateOpenState('opening');
    void open();
    const refresh = () => {
      if (openStateRef.current === 'store_restricted') return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void ChatController.fetchConversationUpdates(peerPubky, 'open').catch(() => {});
    };
    // The leader tab's live stream covers this thread in under a second; this
    // short poll is the floor for follower tabs and for a dropped stream.
    const interval = setInterval(refresh, CHAT_OPEN_THREAD_POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context identity is folded into contextKey
  }, [currentUserPubky, peerPubky, contextKey]);

  useEffect(() => {
    // Roles that arrive or grow decide again, for an open thread that has become a sale as much as for a
    // closed one that was not: a newer open supersedes any open still in flight.
    if (!rolesSeen.current) {
      rolesSeen.current = true;
      return;
    }
    void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the roles reopens the thread
  }, [storeThreadRoles]);

  const conversation = useLiveQuery(async () => {
    if (!currentUserPubky) return null;
    return await ChatController.getConversation(peerPubky);
  }, [currentUserPubky, peerPubky, storeThreadRoles]);

  const page = useLiveQuery(async () => {
    if (!currentUserPubky) return { messages: [] as ChatMessageView[], total: 0 };
    const [messages, total] = await Promise.all([
      ChatController.getMessages(peerPubky, { limit }),
      ChatController.getMessageCount(peerPubky),
    ]);
    return { messages, total };
  }, [currentUserPubky, peerPubky, limit, storeThreadRoles]);

  const messages = page?.messages ?? [];
  const newestReceived = [...messages].reverse().find((row) => row.direction === 'received');

  // Seeing the thread reads it: the checkpoint moves to the newest received
  // message on screen (its sender's clock, which is what unread counts
  // compare against), so a glance at the thread clears the badge without
  // hiding a later message from a peer whose clock lags ours.
  useEffect(() => {
    if (!conversation || !newestReceived || openState === 'store_restricted') return;
    if (newestReceived.sent_at <= conversation.last_read_at) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void ChatController.commitMarkRead(peerPubky, newestReceived.sent_at);
  }, [conversation, newestReceived, openState, peerPubky]);

  return {
    messages,
    hasMore: (page?.total ?? 0) > messages.length,
    loadOlder: () => setLimit((current) => current + CHAT_THREAD_PAGE),
    openState,
    reopen: open,
    retryMessage,
    isSelf,
  };
}
