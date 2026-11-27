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
  const rolesSeen = useRef(storeThreadRoles);
  const accessSeen = useRef<{ key: string; shown: boolean } | null>(null);
  const isSelf = currentUserPubky === peerPubky;
  const contextKey = `${context?.listingId ?? ''}|${context?.orderId ?? ''}`;
  const updateOpenState = (state: UseChatConversationResult['openState']) => {
    openStateRef.current = state;
    setOpenState(state);
  };

  /**
   * Only an open for the route (mount, a new route context, a retry) writes the route's context. An open
   * that decides again after the roles or the stored context changed judges the route's context but never
   * writes it, so a refused one stays refused and a context a message stored is never replaced.
   */
  const open = async ({ write }: { write: boolean }) => {
    if (!currentUserPubky || isSelf) return;
    const run = ++openRun.current;
    try {
      const result = write
        ? await ChatController.commitOpenConversation(peerPubky, context)
        : await ChatController.commitOpenConversation(peerPubky, context, { write: false });
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
    rolesSeen.current = storeThreadRoles;
    void open({ write: true });
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
    if (rolesSeen.current === storeThreadRoles) return;
    rolesSeen.current = storeThreadRoles;
    void open({ write: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the roles reopens the thread
  }, [storeThreadRoles]);

  const conversation = useLiveQuery(async () => {
    if (!currentUserPubky) return null;
    return await ChatController.getConversation(peerPubky);
  }, [currentUserPubky, peerPubky, storeThreadRoles]);

  // Keyed by account and peer: until the new peer's answer arrives, the previous peer's one is returned.
  const access = useLiveQuery(async () => {
    const key = `${currentUserPubky ?? ''}|${peerPubky}`;
    if (!currentUserPubky) return { key, shown: true };
    return { key, shown: await ChatController.getConversationShown(peerPubky) };
  }, [currentUserPubky, peerPubky, storeThreadRoles]);

  useEffect(() => {
    // A message that changes the thread's persisted context can open or close it with the roles unchanged.
    // A thread that closes is restricted at once, before the open decides, so nothing polls or writes meanwhile.
    if (access === undefined) return;
    const previous = accessSeen.current;
    accessSeen.current = access;
    if (previous?.key !== access.key || previous.shown === access.shown) return;
    if (!access.shown) updateOpenState('store_restricted');
    void open({ write: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the access decision reopens the thread
  }, [access]);

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
    reopen: () => open({ write: true }),
    retryMessage,
    isSelf,
  };
}
