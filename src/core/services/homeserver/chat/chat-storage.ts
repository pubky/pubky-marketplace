import { CHAT_FILE_MAX_BYTES, CHAT_LIST_PAGE } from '@/config/chat';
import {
  CHAT_LOG_CONVERSATION,
  CHAT_LOG_FOLDER,
  CHAT_LOG_MESSAGE,
  CHAT_LOG_PRIVATE_KEY,
  CHAT_LOG_PUBLIC_KEY,
  CHAT_MESSAGE_FILE_NAME,
  chatFolderUrl,
  chatMessageUrl,
  chatPrivateKeyUrl,
  chatPrivConversationsUrl,
  chatPrivConversationUrl,
  chatPublicKeyUrl,
  fileNameFromUrl,
  peerFromConversationUrl,
} from '@/libs/chat/paths';
import {
  type ChatEnvelope,
  type ChatPrivateKeyRecord,
  chatPrivateKeySchema,
  type ChatPrivConversationRecord,
  chatPrivConversationSchema,
  type ChatPublicKeyRecord,
  chatPublicKeySchema,
} from '@/libs/chat/schemas';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { HomeserverService } from '@/services/homeserver/homeserver';

/**
 * Chat records on homeservers: public keys and message files under
 * `/pub/chat/v0/`, the private key and conversation index under
 * `/priv/chat/v0/`. Everything goes through {@link HomeserverService};
 * logs and error context carry redacted paths, never a folder next to a peer.
 */
export type ChatPublicKeyLookup =
  | { state: 'found'; record: ChatPublicKeyRecord }
  | { state: 'absent' }
  | { state: 'unreachable' };

export class ChatHomeserverService {
  private constructor() {}

  /**
   * The peer's published key. `absent` covers a missing or malformed record
   * (logged); `unreachable` means their homeserver could not be resolved or
   * answered with an error, so a key known from before is still the best
   * information there is.
   */
  static async readPublicKey(pubky: string): Promise<ChatPublicKeyLookup> {
    const result = await HomeserverService.getJsonIfFound<unknown>({
      url: chatPublicKeyUrl(pubky),
      logUrl: CHAT_LOG_PUBLIC_KEY,
      tolerateUnreachable: true,
    });
    if (!result.found) return { state: result.unreachable ? 'unreachable' : 'absent' };
    const parsed = chatPublicKeySchema.safeParse(result.json);
    if (!parsed.success) {
      Logger.warn('Chat public key record is malformed; treating the peer as not enabled', { pubky });
      return { state: 'absent' };
    }
    return { state: 'found', record: parsed.data };
  }

  static async publishPublicKey(me: string, record: ChatPublicKeyRecord): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: chatPublicKeyUrl(me),
      bodyJson: record,
      logUrl: CHAT_LOG_PUBLIC_KEY,
    });
  }

  static async readPrivateKey(me: string): Promise<ChatPrivateKeyRecord | null> {
    const result = await HomeserverService.getJsonIfFound<unknown>({
      url: chatPrivateKeyUrl(me),
      logUrl: CHAT_LOG_PRIVATE_KEY,
    });
    if (!result.found) return null;
    const parsed = chatPrivateKeySchema.safeParse(result.json);
    if (!parsed.success) {
      Logger.warn('Chat private key record is malformed; a new key will be created');
      return null;
    }
    return parsed.data;
  }

  /** Writes the private key and reads it back: the record counts only once it round-trips. */
  static async writePrivateKey(me: string, record: ChatPrivateKeyRecord): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: chatPrivateKeyUrl(me),
      bodyJson: record,
      logUrl: CHAT_LOG_PRIVATE_KEY,
    });
    const stored = await this.readPrivateKey(me);
    if (!stored || stored.sk !== record.sk || stored.kid !== record.kid) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The chat private key did not store correctly.', {
        service: ErrorService.Homeserver,
        operation: 'writePrivateKey',
        context: { url: CHAT_LOG_PRIVATE_KEY },
      });
    }
  }

  static async readConversationState(me: string, peer: string): Promise<ChatPrivConversationRecord | null> {
    const result = await HomeserverService.getJsonIfFound<unknown>({
      url: chatPrivConversationUrl(me, peer),
      logUrl: CHAT_LOG_CONVERSATION,
    });
    if (!result.found) return null;
    const parsed = chatPrivConversationSchema.safeParse(result.json);
    return parsed.success && parsed.data.peer === peer ? parsed.data : null;
  }

  static async writeConversationState(me: string, record: ChatPrivConversationRecord): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: chatPrivConversationUrl(me, record.peer),
      bodyJson: record,
      logUrl: CHAT_LOG_CONVERSATION,
    });
  }

  /** Every valid conversation record under `/priv/chat/v0/conversations/`. */
  static async listConversationStates(me: string): Promise<ChatPrivConversationRecord[]> {
    const records: ChatPrivConversationRecord[] = [];
    let cursor: string | undefined;
    for (;;) {
      const urls = await HomeserverService.list({
        baseDirectory: chatPrivConversationsUrl(me),
        cursor,
        limit: CHAT_LIST_PAGE,
        logUrl: CHAT_LOG_CONVERSATION,
      });
      for (const url of urls) {
        const peer = peerFromConversationUrl(url);
        if (!peer) continue;
        const record = await this.readConversationState(me, peer);
        if (record) records.push(record);
      }
      if (urls.length < CHAT_LIST_PAGE) break;
      cursor = urls[urls.length - 1];
    }
    return records;
  }

  static async putMessageFile(me: string, folderId: string, fileName: string, envelope: ChatEnvelope): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: chatMessageUrl(me, folderId, fileName),
      bodyJson: envelope,
      logUrl: CHAT_LOG_MESSAGE,
    });
  }

  /**
   * Message file names in a folder, oldest first (or newest first with
   * `reverse`). A cursor lists what comes after that file. A missing
   * folder is an empty list.
   */
  static async listMessageFiles(
    owner: string,
    folderId: string,
    options: { cursor?: string | null; limit?: number; reverse?: boolean } = {},
  ): Promise<string[]> {
    const urls = await HomeserverService.list({
      baseDirectory: chatFolderUrl(owner, folderId),
      cursor: options.cursor ?? undefined,
      limit: options.limit ?? CHAT_LIST_PAGE,
      reverse: options.reverse ?? false,
      logUrl: CHAT_LOG_FOLDER,
    });
    return urls.map(fileNameFromUrl).filter((name) => CHAT_MESSAGE_FILE_NAME.test(name));
  }

  /**
   * A message file's JSON, `null` when it no longer exists, is oversize or
   * is not JSON (both logged and skipped by the caller).
   */
  static async readMessageFile(owner: string, folderId: string, fileName: string): Promise<unknown | null> {
    const result = await HomeserverService.getJsonIfFound<unknown>({
      url: chatMessageUrl(owner, folderId, fileName),
      logUrl: CHAT_LOG_MESSAGE,
      // Refused before the body is read; the homeserver declares the length.
      maxBytes: CHAT_FILE_MAX_BYTES,
    });
    return result.found ? result.json : null;
  }
}
