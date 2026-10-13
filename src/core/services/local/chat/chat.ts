import Dexie from 'dexie';
import { db } from '@/database/franky/franky';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  ChatConversationModel,
  ChatIdentityModel,
  ChatMessageModel,
  ChatSyncStateModel,
} from '@/models/chat/chat.models';
import type {
  ChatContext,
  ChatConversationModelSchema,
  ChatIdentityModelSchema,
  ChatMessageDirection,
  ChatMessageModelSchema,
  ChatSyncStateModelSchema,
} from '@/models/chat/chat.schema';

const PREVIEW_MAX_CHARS = 120;

function dbError(operation: string, error: unknown, context?: Record<string, unknown>) {
  return Err.database(DatabaseErrorCode.QUERY_FAILED, `Chat local store failed: ${operation}`, {
    service: ErrorService.Local,
    operation,
    context,
    cause: error,
  });
}

export function chatPreview(body: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim();
  return flat.length > PREVIEW_MAX_CHARS ? `${flat.slice(0, PREVIEW_MAX_CHARS - 1)}…` : flat;
}

/** Every Dexie read and write of chat state. */
export class LocalChatService {
  private constructor() {}

  // ---------------------------------------------------------------- identity

  static async getIdentity(owner: string): Promise<ChatIdentityModelSchema | null> {
    try {
      return (await ChatIdentityModel.table.get(owner)) ?? null;
    } catch (error) {
      throw dbError('getIdentity', error);
    }
  }

  static async saveIdentity(row: ChatIdentityModelSchema): Promise<void> {
    await ChatIdentityModel.upsert(row);
  }

  // ----------------------------------------------------------- conversations

  static async getConversation(owner: string, peer: string): Promise<ChatConversationModelSchema | null> {
    try {
      return (await ChatConversationModel.table.get(ChatConversationModel.conversationId(owner, peer))) ?? null;
    } catch (error) {
      throw dbError('getConversation', error);
    }
  }

  static async listConversations(owner: string): Promise<ChatConversationModelSchema[]> {
    try {
      const rows = await ChatConversationModel.table.where('owner_id').equals(owner).toArray();
      return rows.sort((a, b) => (b.last_message_at ?? -1) - (a.last_message_at ?? -1) || b.updated_at - a.updated_at);
    } catch (error) {
      throw dbError('listConversations', error);
    }
  }

  static async upsertConversation(row: ChatConversationModelSchema): Promise<void> {
    await ChatConversationModel.upsert(row);
  }

  static async updateConversation(
    owner: string,
    peer: string,
    changes: Partial<ChatConversationModelSchema>,
  ): Promise<void> {
    try {
      await ChatConversationModel.table.update(ChatConversationModel.conversationId(owner, peer), {
        ...changes,
        updated_at: Date.now(),
      });
    } catch (error) {
      throw dbError('updateConversation', error);
    }
  }

  /** Advances the conversation's "latest message" facts monotonically. */
  static async touchConversation(
    owner: string,
    peer: string,
    latest: { sentAt: number; body: string; direction: ChatMessageDirection; context: ChatContext | null },
  ): Promise<void> {
    try {
      await db.transaction('rw', ChatConversationModel.table, async () => {
        const id = ChatConversationModel.conversationId(owner, peer);
        const row = await ChatConversationModel.table.get(id);
        if (!row) return;
        if (row.last_message_at !== null && row.last_message_at > latest.sentAt) return;
        await ChatConversationModel.table.update(id, {
          last_message_at: latest.sentAt,
          last_message_preview: chatPreview(latest.body),
          last_message_direction: latest.direction,
          last_context: latest.context ?? row.last_context,
          updated_at: Date.now(),
        });
      });
    } catch (error) {
      throw dbError('touchConversation', error);
    }
  }

  /** Moves the read checkpoint forward (never back) and flags the `/priv` record dirty. */
  static async markRead(owner: string, peer: string, at: number): Promise<boolean> {
    try {
      return await db.transaction('rw', ChatConversationModel.table, async () => {
        const id = ChatConversationModel.conversationId(owner, peer);
        const row = await ChatConversationModel.table.get(id);
        if (!row || row.last_read_at >= at) return false;
        await ChatConversationModel.table.update(id, {
          last_read_at: at,
          priv_state_dirty: true,
          updated_at: Date.now(),
        });
        return true;
      });
    } catch (error) {
      throw dbError('markRead', error);
    }
  }

  static async listDirtyConversations(owner: string): Promise<ChatConversationModelSchema[]> {
    try {
      return await ChatConversationModel.table
        .where('owner_id')
        .equals(owner)
        .filter((row) => row.priv_state_dirty)
        .toArray();
    } catch (error) {
      throw dbError('listDirtyConversations', error);
    }
  }

  // ---------------------------------------------------------------- messages

  /**
   * Stores rows, ignoring any whose id already exists (replays, retries and
   * overlapping sync triggers all produce duplicates by design).
   * Returns the ids actually added.
   */
  static async addMessages(rows: ChatMessageModelSchema[]): Promise<string[]> {
    if (rows.length === 0) return [];
    try {
      return await db.transaction('rw', ChatMessageModel.table, async () => {
        const existing = new Set(
          (await ChatMessageModel.table.bulkGet(rows.map((row) => row.id)))
            .filter((row): row is ChatMessageModelSchema => row !== undefined)
            .map((row) => row.id),
        );
        const fresh = rows.filter((row) => !existing.has(row.id));
        if (fresh.length > 0) await ChatMessageModel.table.bulkAdd(fresh);
        return fresh.map((row) => row.id);
      });
    } catch (error) {
      throw dbError('addMessages', error, { count: rows.length });
    }
  }

  static async getMessage(id: string): Promise<ChatMessageModelSchema | null> {
    try {
      return (await ChatMessageModel.table.get(id)) ?? null;
    } catch (error) {
      throw dbError('getMessage', error);
    }
  }

  static async putMessage(row: ChatMessageModelSchema): Promise<void> {
    await ChatMessageModel.upsert(row);
  }

  static async updateMessage(id: string, changes: Partial<ChatMessageModelSchema>): Promise<void> {
    try {
      await ChatMessageModel.table.update(id, changes);
    } catch (error) {
      throw dbError('updateMessage', error, { id });
    }
  }

  /** The newest `limit` messages of a thread (optionally before a file name), oldest first. */
  static async listMessages(
    owner: string,
    peer: string,
    options: { before?: string; limit: number },
  ): Promise<ChatMessageModelSchema[]> {
    try {
      const rows = await ChatMessageModel.table
        .where('[owner_id+peer_pubky+file_name]')
        .between([owner, peer, Dexie.minKey], [owner, peer, options.before ?? Dexie.maxKey], true, false)
        .reverse()
        .limit(options.limit)
        .toArray();
      // The index walk picks the newest page; the explicit sort is the order contract.
      return rows.sort((a, b) => (a.file_name < b.file_name ? -1 : a.file_name > b.file_name ? 1 : 0));
    } catch (error) {
      throw dbError('listMessages', error);
    }
  }

  static async countMessages(owner: string, peer: string): Promise<number> {
    try {
      return await ChatMessageModel.table
        .where('[owner_id+peer_pubky+file_name]')
        .between([owner, peer, Dexie.minKey], [owner, peer, Dexie.maxKey])
        .count();
    } catch (error) {
      throw dbError('countMessages', error);
    }
  }

  /** Received messages newer than the read checkpoint. */
  static async countUnread(owner: string, peer: string, lastReadAt: number): Promise<number> {
    try {
      return await ChatMessageModel.table
        .where('[owner_id+peer_pubky+direction+sent_at]')
        .between([owner, peer, 'received', lastReadAt], [owner, peer, 'received', Dexie.maxKey], false, true)
        .count();
    } catch (error) {
      throw dbError('countUnread', error);
    }
  }

  /** Conversations with at least one unread received message. */
  static async countUnreadConversations(owner: string): Promise<number> {
    const conversations = await this.listConversations(owner);
    let unread = 0;
    for (const conversation of conversations) {
      if ((await this.countUnread(owner, conversation.peer_pubky, conversation.last_read_at)) > 0) unread += 1;
    }
    return unread;
  }

  /** Queued rows whose retry time has come, oldest file first. */
  static async listDueOutbox(owner: string, now: number): Promise<ChatMessageModelSchema[]> {
    try {
      const rows = await ChatMessageModel.table.where('[owner_id+status]').equals([owner, 'queued']).toArray();
      return rows
        .filter((row) => row.next_attempt_at === null || row.next_attempt_at <= now)
        .sort((a, b) => (a.file_name < b.file_name ? -1 : a.file_name > b.file_name ? 1 : 0));
    } catch (error) {
      throw dbError('listDueOutbox', error);
    }
  }

  static async hasReceivedFrom(owner: string, peer: string): Promise<boolean> {
    try {
      return (
        (await ChatMessageModel.table
          .where('[owner_id+peer_pubky+direction+sent_at]')
          .between([owner, peer, 'received', Dexie.minKey], [owner, peer, 'received', Dexie.maxKey])
          .count()) > 0
      );
    } catch (error) {
      throw dbError('hasReceivedFrom', error);
    }
  }

  /** File names of the newest `limit` messages in a direction. */
  static async latestFileNames(
    owner: string,
    peer: string,
    direction: ChatMessageDirection,
    limit: number,
  ): Promise<Set<string>> {
    try {
      const rows = await ChatMessageModel.table
        .where('[owner_id+peer_pubky+direction+sent_at]')
        .between([owner, peer, direction, Dexie.minKey], [owner, peer, direction, Dexie.maxKey])
        .reverse()
        .limit(limit)
        .toArray();
      return new Set(rows.map((row) => row.file_name));
    } catch (error) {
      throw dbError('latestFileNames', error);
    }
  }

  // -------------------------------------------------------------- sync state

  static async getSyncState(owner: string, peer: string): Promise<ChatSyncStateModelSchema | null> {
    try {
      return (await ChatSyncStateModel.table.get(ChatConversationModel.conversationId(owner, peer))) ?? null;
    } catch (error) {
      throw dbError('getSyncState', error);
    }
  }

  static async putSyncState(row: ChatSyncStateModelSchema): Promise<void> {
    await ChatSyncStateModel.upsert(row);
  }

  static async updateSyncState(owner: string, peer: string, changes: Partial<ChatSyncStateModelSchema>): Promise<void> {
    try {
      const id = ChatConversationModel.conversationId(owner, peer);
      const updated = await ChatSyncStateModel.table.update(id, changes);
      if (updated === 0) {
        await ChatSyncStateModel.table.put({
          id,
          owner_id: owner,
          peer_pubky: peer,
          list_cursor: null,
          own_list_cursor: null,
          peer_homeserver: null,
          peer_homeserver_checked_at: 0,
          peer_key_checked_at: 0,
          last_synced_at: 0,
          consecutive_failures: 0,
          last_error: null,
          ping_file: null,
          ping_next_at: 0,
          ping_attempts: 0,
          ...changes,
        });
      }
    } catch (error) {
      throw dbError('updateSyncState', error);
    }
  }

  static async listSyncStates(owner: string): Promise<ChatSyncStateModelSchema[]> {
    try {
      return await ChatSyncStateModel.table.where('owner_id').equals(owner).toArray();
    } catch (error) {
      throw dbError('listSyncStates', error);
    }
  }

  // ------------------------------------------------------------------- wipe

  /** Sign-out and account switch: every chat row of this device. */
  static async clearAll(): Promise<void> {
    try {
      await Promise.all([
        ChatIdentityModel.table.clear(),
        ChatConversationModel.table.clear(),
        ChatMessageModel.table.clear(),
        ChatSyncStateModel.table.clear(),
      ]);
    } catch (error) {
      throw dbError('clearAll', error);
    }
  }
}
