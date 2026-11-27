import type { ChatContext } from '@/models/chat/chat.schema';

export type ChatIdentityState = 'ready' | 'needs_reauth';

export type ChatPeerKeys = {
  state: 'ready';
  peerKid: string;
  peerPublicKey: Uint8Array;
  /** The folder I write into on my homeserver. */
  ownFolderId: string;
  /** The folder the peer writes into on their homeserver; what I list and stream. */
  peerFolderId: string;
  messageKey: Uint8Array;
};
export type ChatPeerKeyResult = ChatPeerKeys | { state: 'no_key' };

export type ChatOpenResult = { state: 'ready' } | { state: 'peer_not_enabled' } | { state: 'needs_reauth' };

/** Whether a queued message may be sent now; one it refuses stays as it is. */
export type ChatOutboxSends = (message: { peer_pubky: string; context: ChatContext | null }) => Promise<boolean>;

export type ChatSyncReason = 'open' | 'event' | 'key_event' | 'ping' | 'reconcile' | 'rebuild' | 'seed';
export type ChatSyncOutcome = 'synced' | 'peer_not_enabled' | 'skipped';

export type ChatQueueParams = { peer: string; body: string; context?: ChatContext; judgedContext?: ChatContext | null };
