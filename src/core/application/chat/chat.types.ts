import type { ChatContext } from '@/models/chat/chat.schema';

export type ChatIdentityState = 'ready' | 'needs_reauth';

export type ChatPeerKeys = {
  state: 'ready';
  peerKid: string;
  peerPublicKey: Uint8Array;
  folderId: string;
  messageKey: Uint8Array;
};
export type ChatPeerKeyResult = ChatPeerKeys | { state: 'no_key' };

export type ChatOpenResult = { state: 'ready' } | { state: 'peer_not_enabled' } | { state: 'needs_reauth' };

export type ChatSyncReason = 'open' | 'event' | 'key_event' | 'ping' | 'reconcile' | 'rebuild' | 'seed';
export type ChatSyncOutcome = 'synced' | 'peer_not_enabled' | 'skipped';

export type ChatQueueParams = { peer: string; body: string; context?: ChatContext };
