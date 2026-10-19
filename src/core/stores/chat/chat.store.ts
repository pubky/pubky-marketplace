import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { chatInitialState, type ChatStore } from './chat.types';

/**
 * Ephemeral chat facts for the UI: identity readiness, inbox connectivity,
 * sync status and whether this tab leads background sync. Unread counts
 * are NOT here; they come from Dexie through live queries.
 */
export const useChatStore = create<ChatStore>()(
  devtools(
    (set) => ({
      ...chatInitialState,
      setIdentityState: (identityState) => set({ identityState }, false, 'chat/setIdentityState'),
      setInboxStatus: (inboxStatus) => set({ inboxStatus }, false, 'chat/setInboxStatus'),
      setSyncStatus: (syncStatus, at) =>
        set(
          (state) => ({ syncStatus, lastSyncAt: syncStatus === 'idle' ? (at ?? Date.now()) : state.lastSyncAt }),
          false,
          'chat/setSyncStatus',
        ),
      setLeaderTab: (isLeaderTab) => set({ isLeaderTab }, false, 'chat/setLeaderTab'),
      reset: () => set(chatInitialState, false, 'chat/reset'),
    }),
    { name: 'chat-store', enabled: process.env.NODE_ENV === 'development' },
  ),
);
