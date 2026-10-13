import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from './encoding';
import { type ChatEnvelope, chatEnvelopeSchema, type ChatPlaintext, chatPlaintextSchema } from './schemas';

/**
 * Chat crypto, version 0: a static X25519 key per user, a pairwise root from
 * ECDH, and XChaCha20-Poly1305 message envelopes bound to their path.
 *
 *   root        = HKDF(X25519(sk_me, pk_peer), salt "pubky-chat/v0",
 *                      info "root" || pubky_low || pk_low || pubky_high || pk_high)   (low/high by pk bytes)
 *   folder id   = hex(HKDF(root, "folder" || <sender pubky>, 16))
 *   message key = HKDF(root, "message", 32)
 *   AAD         = "<sender>|<recipient>|<path>"
 *
 * Both parties compute the same root and message key (the info sorts the
 * two (pubky, pk) pairs). Binding the pubkys means a copied public key file
 * under another account yields a different root. Folder ids are per
 * direction: the folder a user writes into is derived from their own pubky,
 * so the same id never appears on both homeservers and a third party cannot
 * link two users by intersecting their public folder listings. No forward
 * secrecy: a leaked private key opens every message with that peer. Key
 * material is zeroed after use where the caller hands it over.
 */

const SALT = new TextEncoder().encode('pubky-chat/v0');
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
export const CHAT_NONCE_BYTES = NONCE_BYTES;

export type ChatKeypair = { publicKey: Uint8Array; secretKey: Uint8Array };

export function generateChatKeypair(): ChatKeypair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function chatPublicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

/** 16 hex chars: the first 8 bytes of sha256(public key). */
export function chatKeyId(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey).slice(0, 8));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** One side of a conversation: the account and its published chat key. */
export type ChatPairParty = { pubky: string; publicKey: Uint8Array };

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Symmetric pairwise root bound to both accounts. Throws on a low-order
 * peer key (all-zero shared secret) and on a peer key equal to my own (a
 * copied key file).
 */
export function derivePairwiseRoot(mySecretKey: Uint8Array, me: ChatPairParty, peer: ChatPairParty): Uint8Array {
  if (compareBytes(me.publicKey, peer.publicKey) === 0) throw new Error('Peer key equals own key');
  const shared = x25519.getSharedSecret(mySecretKey, peer.publicKey);
  if (shared.every((byte) => byte === 0)) throw new Error('Low-order peer key');
  const [low, high] = compareBytes(me.publicKey, peer.publicKey) < 0 ? [me, peer] : [peer, me];
  const encoder = new TextEncoder();
  const info = concatBytes(
    encoder.encode('root'),
    encoder.encode(low.pubky),
    low.publicKey,
    encoder.encode(high.pubky),
    high.publicKey,
  );
  const root = hkdf(sha256, shared, SALT, info, KEY_BYTES);
  shared.fill(0);
  return root;
}

/** The folder `senderPubky` writes into for this pair; the other side derives it to read. */
export function deriveFolderId(root: Uint8Array, senderPubky: string): string {
  const encoder = new TextEncoder();
  const info = concatBytes(encoder.encode('folder'), encoder.encode(senderPubky));
  return bytesToHex(hkdf(sha256, root, SALT, info, 16));
}

export function deriveMessageKey(root: Uint8Array): Uint8Array {
  return hkdf(sha256, root, SALT, new TextEncoder().encode('message'), KEY_BYTES);
}

/**
 * Everything a conversation needs from the pair: the folder I write into
 * (`ownFolderId`), the folder I read the peer's messages from
 * (`peerFolderId`) and the shared message key.
 */
export function derivePairwise(
  mySecretKey: Uint8Array,
  me: ChatPairParty,
  peer: ChatPairParty,
): { ownFolderId: string; peerFolderId: string; messageKey: Uint8Array } {
  const root = derivePairwiseRoot(mySecretKey, me, peer);
  const result = {
    ownFolderId: deriveFolderId(root, me.pubky),
    peerFolderId: deriveFolderId(root, peer.pubky),
    messageKey: deriveMessageKey(root),
  };
  root.fill(0);
  return result;
}

export function chatAad(sender: string, recipient: string, path: string): Uint8Array {
  if ([sender, recipient, path].some((part) => part.includes('|'))) throw new Error('AAD part contains a separator');
  return new TextEncoder().encode(`${sender}|${recipient}|${path}`);
}

export function encryptChatEnvelope(input: {
  messageKey: Uint8Array;
  senderKid: string;
  recipientKid: string;
  aad: Uint8Array;
  plaintext: ChatPlaintext;
}): ChatEnvelope {
  const nonce = randomBytes(NONCE_BYTES);
  const bytes = new TextEncoder().encode(JSON.stringify(input.plaintext));
  const ciphertext = xchacha20poly1305(input.messageKey, nonce, input.aad).encrypt(bytes);
  return {
    v: 0,
    enc: 'pubky-chat/xchacha20poly1305/v0',
    ks: input.senderKid,
    kr: input.recipientKid,
    n: bytesToBase64Url(nonce),
    ct: bytesToBase64Url(ciphertext),
  };
}

export type ChatDecryptResult =
  | { ok: true; plaintext: ChatPlaintext }
  | { ok: false; reason: 'malformed' | 'unknown_key' | 'unauthenticated' | 'invalid_plaintext' };

/**
 * Opens a message file. Never throws for bad input: a malformed file, a
 * foreign key id, a failed authentication tag or an invalid plaintext each
 * come back as a reason the caller logs and skips.
 */
export function decryptChatEnvelope(input: {
  messageKey: Uint8Array;
  expectedSenderKid: string;
  expectedRecipientKid: string;
  aad: Uint8Array;
  envelope: unknown;
}): ChatDecryptResult {
  const parsed = chatEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  const envelope = parsed.data;
  if (envelope.ks !== input.expectedSenderKid || envelope.kr !== input.expectedRecipientKid) {
    return { ok: false, reason: 'unknown_key' };
  }
  const nonce = base64UrlToBytes(envelope.n);
  const ciphertext = base64UrlToBytes(envelope.ct);
  if (!nonce || nonce.length !== NONCE_BYTES || !ciphertext) return { ok: false, reason: 'malformed' };
  let bytes: Uint8Array;
  try {
    bytes = xchacha20poly1305(input.messageKey, nonce, input.aad).decrypt(ciphertext);
  } catch {
    return { ok: false, reason: 'unauthenticated' };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: 'invalid_plaintext' };
  }
  const plaintext = chatPlaintextSchema.safeParse(json);
  if (!plaintext.success) return { ok: false, reason: 'invalid_plaintext' };
  return { ok: true, plaintext: plaintext.data };
}
