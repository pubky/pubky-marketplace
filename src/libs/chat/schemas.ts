import { z } from 'zod';
import { CHAT_BODY_MAX_BYTES } from '@/config/chat';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { utf8Bytes } from './encoding';
import { CHAT_FOLDER_ID, CHAT_MESSAGE_FILE_NAME, isChatPingSlot } from './paths';

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/u);
const kid = z.string().regex(/^[0-9a-f]{16}$/u);

/** `/pub/chat/v0/key.json` */
export const chatPublicKeySchema = z
  .object({
    v: z.literal(0),
    alg: z.literal('x25519'),
    kid,
    pk: b64url,
    created_at: z.int().positive(),
  })
  .strict();
export type ChatPublicKeyRecord = z.infer<typeof chatPublicKeySchema>;

/** `/priv/chat/v0/key.json` */
export const chatPrivateKeySchema = chatPublicKeySchema.extend({ sk: b64url }).strict();
export type ChatPrivateKeyRecord = z.infer<typeof chatPrivateKeySchema>;

export const chatContextSchema = z
  .object({
    listingId: z.string().min(1).max(128).optional(),
    orderId: z.string().min(1).max(128).optional(),
  })
  .strict();

/** What a message file decrypts to. */
export const chatPlaintextSchema = z
  .object({
    v: z.literal(0),
    id: z.uuid(),
    from: commercePubkySchema,
    to: commercePubkySchema,
    sent_at: z.int().positive(),
    body: z
      .string()
      .min(1)
      .refine((body) => utf8Bytes(body) <= CHAT_BODY_MAX_BYTES, 'Message is too long.'),
    context: chatContextSchema.optional(),
  })
  .strict();
export type ChatPlaintext = z.infer<typeof chatPlaintextSchema>;

/** A message file on the homeserver. */
export const chatEnvelopeSchema = z
  .object({
    v: z.literal(0),
    enc: z.literal('pubky-chat/xchacha20poly1305/v0'),
    /** Sender key id. */
    ks: kid,
    /** Recipient key id. */
    kr: kid,
    n: b64url,
    ct: b64url,
  })
  .strict();
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;

/** `/priv/chat/v0/conversations/<peer>.json` */
export const chatPrivConversationSchema = z
  .object({
    v: z.literal(0),
    peer: commercePubkySchema,
    folder_id: z.string().regex(CHAT_FOLDER_ID),
    peer_kid: kid,
    created_at: z.int().positive(),
    last_read_at: z.int().nonnegative(),
    context: chatContextSchema.nullable(),
  })
  .strict();
export type ChatPrivConversationRecord = z.infer<typeof chatPrivConversationSchema>;

/** Inbox ping payload. A hint only: the receiver always derives the folder itself. */
export const chatPingPayloadSchema = z
  .object({
    v: z.literal(0),
    t: z.literal('chat'),
    folder: z.string().regex(CHAT_FOLDER_ID),
    file: z.string().regex(CHAT_MESSAGE_FILE_NAME),
    /** Padding so every ping has the same size. */
    p: z.string().optional(),
  })
  .strict();
export type ChatPingPayload = z.infer<typeof chatPingPayloadSchema>;

/** A ping is ours when it sits in the chat slot family and carries a well-formed chat payload. */
export function isChatPing(ping: { slot: string; payload: string }): boolean {
  if (!isChatPingSlot(ping.slot)) return false;
  try {
    return chatPingPayloadSchema.safeParse(JSON.parse(ping.payload)).success;
  } catch {
    return false;
  }
}
