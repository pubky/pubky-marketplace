/**
 * Chat (buyer↔seller messaging) Dexie tables. Every row is a CACHE of state
 * that lives on homeservers (`/pub/chat/v0`, `/priv/chat/v0`); sign-out wipes
 * all four tables and sign-in rebuilds them. Every row carries `owner_id`.
 */

/** Listing or order a message is about; rendered as a context chip. */
export type ChatContext = {
  listingId?: string;
  orderId?: string;
};

/** The signed-in account's X25519 key pair, mirrored from `/priv/chat/v0/key.json`. */
export interface ChatIdentityModelSchema {
  /** Owner pubky. */
  id: string;
  /** 16 hex chars: first 8 bytes of sha256(public_key). */
  kid: string;
  public_key: Uint8Array;
  secret_key: Uint8Array;
  /** `/pub/chat/v0/key.json` was confirmed to advertise this key. */
  published: boolean;
  created_at: number;
}
export const chatIdentityTableSchema = '&id';

export type ChatPeerState = 'ready' | 'no_key';
export type ChatConversationOrigin = 'local' | 'remote' | 'seeded' | 'ping';
export type ChatMessageDirection = 'sent' | 'received';

export interface ChatConversationModelSchema {
  /** `${owner_id}:${peer_pubky}` */
  id: string;
  owner_id: string;
  peer_pubky: string;
  /** The peer's folder under their `/pub/chat/v0/` that I read (per direction); null while the peer has no key. */
  folder_id: string | null;
  /** The folder under my `/pub/chat/v0/` that I write into for this peer; null while the peer has no key. */
  own_folder_id: string | null;
  /** The peer kid the folder was derived from (rotation detection). */
  peer_key_id: string | null;
  /** The peer's X25519 public key (base64url), cached from `/pub/chat/v0/key.json`. */
  peer_public_key: string | null;
  my_key_id: string;
  peer_state: ChatPeerState;
  origin: ChatConversationOrigin;
  /** Newest `sent_at` over both directions, or null before any message. */
  last_message_at: number | null;
  last_message_preview: string | null;
  last_message_direction: ChatMessageDirection | null;
  /** Read checkpoint; 0 = never. Mirrored to `/priv/chat/v0/conversations/<peer>.json`. */
  last_read_at: number;
  last_context: ChatContext | null;
  /** The `/priv` conversation record needs (re)writing. */
  priv_state_dirty: boolean;
  created_at: number;
  updated_at: number;
}
export const chatConversationTableSchema =
  '&id, owner_id, [owner_id+last_message_at], [owner_id+folder_id], [owner_id+peer_state]';

export type ChatMessageStatus = 'queued' | 'sent' | 'failed';

export interface ChatMessageModelSchema {
  /** `${owner_id}:${message id}` where the message id is the sender-minted uuid. */
  id: string;
  owner_id: string;
  peer_pubky: string;
  direction: ChatMessageDirection;
  /** `<sent_at ms, 13 digits>-<8 hex>.json`: the sort key (sender clock). */
  file_name: string;
  sent_at: number;
  /** Local persist time. */
  received_at: number;
  body: string;
  context: ChatContext | null;
  /** Received rows are always `sent`. */
  status: ChatMessageStatus;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  /** `sent_at` was ahead of the local clock by more than the tolerance. */
  clock_skewed: boolean;
}
export const chatMessageTableSchema = [
  '&id',
  'owner_id',
  '[owner_id+peer_pubky+file_name]',
  '[owner_id+peer_pubky+direction+sent_at]',
  '[owner_id+status]',
].join(', ');

export interface ChatSyncStateModelSchema {
  /** `${owner_id}:${peer_pubky}` */
  id: string;
  owner_id: string;
  peer_pubky: string;
  /** Last listed file URL in the peer's folder (homeserver list cursor). */
  list_cursor: string | null;
  /** Same for the owner's own folder (new-device rebuild). */
  own_list_cursor: string | null;
  /** The peer's homeserver pubky (cached pkarr lookup) and when it was last resolved. */
  peer_homeserver: string | null;
  peer_homeserver_checked_at: number;
  peer_key_checked_at: number;
  last_synced_at: number;
  consecutive_failures: number;
  last_error: string | null;
  /**
   * Newest sent file still owed an inbox ping: retried on failure, and while
   * the peer has never written back repeated until they do.
   */
  ping_file: string | null;
  /** When the next ping attempt is due (ms epoch; 0 = at once). */
  ping_next_at: number;
  /** Consecutive failed ping attempts, for the backoff. */
  ping_attempts: number;
}
export const chatSyncStateTableSchema = '&id, owner_id, [owner_id+peer_homeserver]';
