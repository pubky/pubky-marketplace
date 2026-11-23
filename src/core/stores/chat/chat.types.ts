import type { ChatIdentityState } from '@/application/chat/chat.types';
import type { StoreThreadRoles } from '@/pipes/commerce/store-seller-side';
import type { InboxAvailability } from '@/services/inbox/inbox.types';

export type ChatInboxStatus = InboxAvailability | 'unknown' | 'connecting';
export type ChatSyncStatus = 'idle' | 'syncing' | 'error';

export interface ChatState {
  identityState: ChatIdentityState | 'unknown' | 'error';
  inboxStatus: ChatInboxStatus;
  syncStatus: ChatSyncStatus;
  lastSyncAt: number | null;
  isLeaderTab: boolean;
  /** In a store the viewer does not sell in: which chat peers it sold to or bought from; null until read. */
  storeThreadRoles: StoreThreadRoles | null;
}

export interface ChatActions {
  setIdentityState: (state: ChatState['identityState']) => void;
  setInboxStatus: (status: ChatInboxStatus) => void;
  setSyncStatus: (status: ChatSyncStatus, at?: number) => void;
  setLeaderTab: (isLeader: boolean) => void;
  setStoreThreadRoles: (roles: StoreThreadRoles | null) => void;
  reset: () => void;
}

export type ChatStore = ChatState & ChatActions;

export const chatInitialState: ChatState = {
  identityState: 'unknown',
  inboxStatus: 'unknown',
  syncStatus: 'idle',
  lastSyncAt: null,
  isLeaderTab: false,
  storeThreadRoles: null,
};
