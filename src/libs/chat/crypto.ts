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
 *   root        = HKDF(X25519(sk_me, pk_peer), salt "pubky-chat/v0", info "root" || min(pk) || max(pk))
 *   folder id   = hex(HKDF(root, "folder", 16))
 *   message key = HKDF(root, "message", 32)
 *   AAD         = "<sender>|<recipient>|<path>"
 *
 * Both parties compute the same root (the info sorts the public keys), so
 * both derive the same folder id and message key. No forward secrecy: a
 * leaked private key opens every message with that peer. Key material is
 * zeroed after use where the caller hands it over.
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

/** Symmetric pairwise root; throws on a low-order peer key (all-zero shared secret). */
export function derivePairwiseRoot(
  mySecretKey: Uint8Array,
  myPublicKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Uint8Array {
  const shared = x25519.getSharedSecret(mySecretKey, peerPublicKey);
  if (shared.every((byte) => byte === 0)) throw new Error('Low-order peer key');
  const [low, high] =
    compareBytes(myPublicKey, peerPublicKey) <= 0 ? [myPublicKey, peerPublicKey] : [peerPublicKey, myPublicKey];
  const info = new Uint8Array(4 + low.length + high.length);
  info.set(new TextEncoder().encode('root'), 0);
  info.set(low, 4);
  info.set(high, 4 + low.length);
  const root = hkdf(sha256, shared, SALT, info, KEY_BYTES);
  shared.fill(0);
  return root;
}

export function deriveFolderId(root: Uint8Array): string {
  return bytesToHex(hkdf(sha256, root, SALT, new TextEncoder().encode('folder'), 16));
}

export function deriveMessageKey(root: Uint8Array): Uint8Array {
  return hkdf(sha256, root, SALT, new TextEncoder().encode('message'), KEY_BYTES);
}

/** Everything a conversation needs from the pair of keys. */
export function derivePairwise(
  mySecretKey: Uint8Array,
  myPublicKey: Uint8Array,
  peerPublicKey: Uint8Array,
): { folderId: string; messageKey: Uint8Array } {
  const root = derivePairwiseRoot(mySecretKey, myPublicKey, peerPublicKey);
  const result = { folderId: deriveFolderId(root), messageKey: deriveMessageKey(root) };
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
