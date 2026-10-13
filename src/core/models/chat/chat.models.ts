import type { Table } from 'dexie';
import { db } from '@/database/franky/franky';
import { ModelBase } from '@/models/shared/base/baseModel';
import type {
  ChatConversationModelSchema,
  ChatIdentityModelSchema,
  ChatMessageModelSchema,
  ChatSyncStateModelSchema,
} from './chat.schema';

export class ChatIdentityModel extends ModelBase<string, ChatIdentityModelSchema> implements ChatIdentityModelSchema {
  static table: Table<ChatIdentityModelSchema> = db.table('chat_identity');

  kid: string;
  public_key: Uint8Array;
  secret_key: Uint8Array;
  published: boolean;
  created_at: number;

  constructor(row: ChatIdentityModelSchema) {
    super(row);
    this.kid = row.kid;
    this.public_key = row.public_key;
    this.secret_key = row.secret_key;
    this.published = row.published;
    this.created_at = row.created_at;
  }
}

export class ChatConversationModel
  extends ModelBase<string, ChatConversationModelSchema>
  implements ChatConversationModelSchema
{
  static table: Table<ChatConversationModelSchema> = db.table('chat_conversations');

  owner_id: string;
  peer_pubky: string;
  folder_id: string | null;
  own_folder_id: string | null;
  peer_key_id: string | null;
  peer_public_key: string | null;
  my_key_id: string;
  peer_state: ChatConversationModelSchema['peer_state'];
  origin: ChatConversationModelSchema['origin'];
  last_message_at: number | null;
  last_message_preview: string | null;
  last_message_direction: ChatConversationModelSchema['last_message_direction'];
  last_read_at: number;
  last_context: ChatConversationModelSchema['last_context'];
  priv_state_dirty: boolean;
  created_at: number;
  updated_at: number;

  constructor(row: ChatConversationModelSchema) {
    super(row);
    this.owner_id = row.owner_id;
    this.peer_pubky = row.peer_pubky;
    this.folder_id = row.folder_id;
    this.own_folder_id = row.own_folder_id ?? null;
    this.peer_key_id = row.peer_key_id;
    this.peer_public_key = row.peer_public_key;
    this.my_key_id = row.my_key_id;
    this.peer_state = row.peer_state;
    this.origin = row.origin;
    this.last_message_at = row.last_message_at;
    this.last_message_preview = row.last_message_preview;
    this.last_message_direction = row.last_message_direction;
    this.last_read_at = row.last_read_at;
    this.last_context = row.last_context;
    this.priv_state_dirty = row.priv_state_dirty;
    this.created_at = row.created_at;
    this.updated_at = row.updated_at;
  }

  static conversationId(owner: string, peer: string): string {
    return `${owner}:${peer}`;
  }
}

export class ChatMessageModel extends ModelBase<string, ChatMessageModelSchema> implements ChatMessageModelSchema {
  static table: Table<ChatMessageModelSchema> = db.table('chat_messages');

  owner_id: string;
  peer_pubky: string;
  direction: ChatMessageModelSchema['direction'];
  file_name: string;
  sent_at: number;
  received_at: number;
  body: string;
  context: ChatMessageModelSchema['context'];
  status: ChatMessageModelSchema['status'];
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  clock_skewed: boolean;

  constructor(row: ChatMessageModelSchema) {
    super(row);
    this.owner_id = row.owner_id;
    this.peer_pubky = row.peer_pubky;
    this.direction = row.direction;
    this.file_name = row.file_name;
    this.sent_at = row.sent_at;
    this.received_at = row.received_at;
    this.body = row.body;
    this.context = row.context;
    this.status = row.status;
    this.attempts = row.attempts;
    this.next_attempt_at = row.next_attempt_at;
    this.last_error = row.last_error;
    this.clock_skewed = row.clock_skewed;
  }

  static rowId(owner: string, messageId: string): string {
    return `${owner}:${messageId}`;
  }
}

export class ChatSyncStateModel
  extends ModelBase<string, ChatSyncStateModelSchema>
  implements ChatSyncStateModelSchema
{
  static table: Table<ChatSyncStateModelSchema> = db.table('chat_sync_state');

  owner_id: string;
  peer_pubky: string;
  list_cursor: string | null;
  own_list_cursor: string | null;
  peer_homeserver: string | null;
  peer_homeserver_checked_at: number;
  peer_key_checked_at: number;
  last_synced_at: number;
  consecutive_failures: number;
  last_error: string | null;
  ping_file: string | null;
  ping_next_at: number;
  ping_attempts: number;

  constructor(row: ChatSyncStateModelSchema) {
    super(row);
    this.owner_id = row.owner_id;
    this.peer_pubky = row.peer_pubky;
    this.list_cursor = row.list_cursor;
    this.own_list_cursor = row.own_list_cursor;
    this.peer_homeserver = row.peer_homeserver;
    this.peer_homeserver_checked_at = row.peer_homeserver_checked_at ?? 0;
    this.peer_key_checked_at = row.peer_key_checked_at;
    this.last_synced_at = row.last_synced_at;
    this.consecutive_failures = row.consecutive_failures;
    this.last_error = row.last_error;
    this.ping_file = row.ping_file ?? null;
    this.ping_next_at = row.ping_next_at ?? 0;
    this.ping_attempts = row.ping_attempts ?? 0;
  }
}
