import type { ChatIdentityState } from '@/application/chat/chat.types';
import type { InboxAvailability } from '@/services/inbox/inbox.types';

export type ChatInboxStatus = InboxAvailability | 'unknown' | 'connecting';
export type ChatSyncStatus = 'idle' | 'syncing' | 'error';

export interface ChatState {
  identityState: ChatIdentityState | 'unknown' | 'error';
  inboxStatus: ChatInboxStatus;
  syncStatus: ChatSyncStatus;
  lastSyncAt: number | null;
  isLeaderTab: boolean;
}

export interface ChatActions {
  setIdentityState: (state: ChatState['identityState']) => void;
  setInboxStatus: (status: ChatInboxStatus) => void;
  setSyncStatus: (status: ChatSyncStatus, at?: number) => void;
  setLeaderTab: (isLeader: boolean) => void;
  reset: () => void;
}

export type ChatStore = ChatState & ChatActions;

export const chatInitialState: ChatState = {
  identityState: 'unknown',
  inboxStatus: 'unknown',
  syncStatus: 'idle',
  lastSyncAt: null,
  isLeaderTab: false,
};
