/**
 * Homeserver layout of buyer↔seller chat, version 0.
 *
 *   pubky://<me>/pub/chat/v0/key.json                     public X25519 key
 *   pubky://<me>/pub/chat/v0/<folder>/<file>              one encrypted file per message I sent
 *   pubky://<me>/priv/chat/v0/key.json                    private key (owner-only)
 *   pubky://<me>/priv/chat/v0/conversations/<peer>.json   conversation index + read checkpoint
 *
 * `<folder>` is derived from the pair's shared secret, so only the two
 * parties know which folder is theirs. `<file>` sorts chronologically.
 */

export const CHAT_PUB_ROOT = '/pub/chat/v0/';
export const CHAT_PRIV_ROOT = '/priv/chat/v0/';
export const CHAT_KEY_FILE = 'key.json';

/** Redacted forms for logs and error context: never a folder id next to a peer. */
export const CHAT_LOG_PUBLIC_KEY = `${CHAT_PUB_ROOT}${CHAT_KEY_FILE}`;
export const CHAT_LOG_PRIVATE_KEY = `${CHAT_PRIV_ROOT}${CHAT_KEY_FILE}`;
export const CHAT_LOG_FOLDER = `${CHAT_PUB_ROOT}<folder>/`;
export const CHAT_LOG_MESSAGE = `${CHAT_PUB_ROOT}<folder>/<file>`;
export const CHAT_LOG_CONVERSATION = `${CHAT_PRIV_ROOT}conversations/<peer>.json`;

export const CHAT_FOLDER_ID = /^[0-9a-f]{32}$/u;
export const CHAT_MESSAGE_FILE_NAME = /^(\d{13})-([0-9a-f]{8})\.json$/u;

export const chatPublicKeyUrl = (pubky: string): string => `pubky://${pubky}${CHAT_PUB_ROOT}${CHAT_KEY_FILE}`;
export const chatPrivateKeyUrl = (me: string): string => `pubky://${me}${CHAT_PRIV_ROOT}${CHAT_KEY_FILE}`;
export const chatPrivConversationsUrl = (me: string): string => `pubky://${me}${CHAT_PRIV_ROOT}conversations/`;
export const chatPrivConversationUrl = (me: string, peer: string): string =>
  `${chatPrivConversationsUrl(me)}${peer}.json`;
/** Path (no scheme/host) of a conversation folder: the event-stream filter and the AAD prefix. */
export const chatFolderPath = (folderId: string): string => `${CHAT_PUB_ROOT}${folderId}/`;
export const chatFolderUrl = (owner: string, folderId: string): string => `pubky://${owner}${chatFolderPath(folderId)}`;
export const chatMessagePath = (folderId: string, fileName: string): string => `${chatFolderPath(folderId)}${fileName}`;
export const chatMessageUrl = (owner: string, folderId: string, fileName: string): string =>
  `pubky://${owner}${chatMessagePath(folderId, fileName)}`;

/** `<sent_at ms, 13 digits>-<8 random hex>.json` — chronological under a directory list. */
export function mintChatFileName(sentAt: number, randomHex8?: string): string {
  const suffix = randomHex8 ?? randomHex(4);
  return `${String(Math.max(0, Math.floor(sentAt))).padStart(13, '0')}-${suffix}.json`;
}

export function parseChatFileName(name: string): { sentAt: number } | null {
  const match = CHAT_MESSAGE_FILE_NAME.exec(name);
  if (!match) return null;
  return { sentAt: Number(match[1]) };
}

/** Last path segment of a `pubky://` or `/`-separated URL. */
export function fileNameFromUrl(url: string): string {
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** The peer pubky a `/priv/chat/v0/conversations/<peer>.json` URL names, or null. */
export function peerFromConversationUrl(url: string): string | null {
  const name = fileNameFromUrl(url);
  if (!name.endsWith('.json')) return null;
  const peer = name.slice(0, -'.json'.length);
  return /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/u.test(peer) ? peer : null;
}

/** Whether an event-stream path is a message file under `/pub/chat/v0/<folder>/`. */
export function parseChatEventPath(path: string): { folderId: string; fileName: string } | { key: true } | null {
  if (path === CHAT_LOG_PUBLIC_KEY) return { key: true };
  if (!path.startsWith(CHAT_PUB_ROOT)) return null;
  const rest = path.slice(CHAT_PUB_ROOT.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const folderId = rest.slice(0, slash);
  const fileName = rest.slice(slash + 1);
  if (!CHAT_FOLDER_ID.test(folderId) || !CHAT_MESSAGE_FILE_NAME.test(fileName)) return null;
  return { folderId, fileName };
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Inbox ping slot for a conversation folder. The inbox accepts 1–64 Base64url
 * characters, so the folder id (hex) is joined with a dash, not a colon.
 */
export function chatPingSlot(folderId: string): string {
  return `chat-${folderId}`;
}
