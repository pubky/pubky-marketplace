/**
 * Encrypted delivery address envelope (design: docs/ecommerce/encrypted-delivery-address-design.md).
 *
 * The buyer's browser seals the address to the seller's published delivery
 * key with RFC 9180 HPKE, the same suite the pubky homeserver uses for grant
 * approvals: DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305,
 * implemented by `hpke-js`. No key schedule, KDF, nonce or AEAD composition is
 * written here: this module only fixes the context strings, pads the
 * plaintext to one bucket and frames the bytes.
 *
 * Wire bytes: `enc (32) || ciphertext (2048 + 16)` = 2096 bytes, base64url
 * without padding. The marketplace service checks only that length.
 */

import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';
import {
  DELIVERY_ENVELOPE_BYTES,
  DELIVERY_KEY_ID_PATTERN,
  DELIVERY_PLAINTEXT_BUCKET_BYTES,
  HPKE_ENC_BYTES,
} from '@/libs/commerce/delivery-envelope-format';
import { type CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import { base64UrlToBytes, bytesToBase64Url } from '@/libs/commerce/priv-envelope';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';

export const DELIVERY_ENVELOPE_CONTEXT = 'pubky-marketplace/delivery-address/v1';
export {
  DELIVERY_ENVELOPE_BYTES,
  DELIVERY_KEY_ID_PATTERN,
  DELIVERY_PLAINTEXT_BUCKET_BYTES,
} from '@/libs/commerce/delivery-envelope-format';
const PAD_DELIMITER = 0x80;

export const DELIVERY_KEYS_PATH = '/pub/pubky.app/marketplace/v1/delivery-keys/';
export const DELIVERY_KEY_CURRENT_FILE = 'current';

export class DeliveryEnvelopeError extends Error {
  constructor(
    readonly code:
      | 'address_too_long'
      | 'malformed_envelope'
      | 'key_id_mismatch'
      | 'open_failed'
      | 'bad_padding'
      | 'bad_key',
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryEnvelopeError';
  }
}

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

/** Binds an envelope to one checkout command, buyer, seller and key. */
export type DeliveryEnvelopeBinding = {
  checkoutCommandId: string;
  buyerPubky: string;
  sellerPubky: string;
  keyId: string;
};

const bindingSchema = z.object({
  checkoutCommandId: z.uuid(),
  buyerPubky: commercePubkySchema,
  sellerPubky: commercePubkySchema,
  keyId: z.string().regex(DELIVERY_KEY_ID_PATTERN),
});

const encoder = new TextEncoder();

export function buildDeliveryAad(binding: DeliveryEnvelopeBinding): Uint8Array {
  const parsed = bindingSchema.parse(binding);
  return encoder.encode(
    `${DELIVERY_ENVELOPE_CONTEXT}|${parsed.checkoutCommandId.toLowerCase()}|${parsed.buyerPubky}|${parsed.sellerPubky}|${parsed.keyId}`,
  );
}

/** The derived key id: first 16 bytes of SHA-256 of the 32-byte public key, lowercase hex. */
export function deliveryKeyId(publicKey: Uint8Array): string {
  if (publicKey.byteLength !== HPKE_ENC_BYTES) {
    throw new DeliveryEnvelopeError('bad_key', 'A delivery public key is 32 bytes.');
  }
  return bytesToHex(sha256(publicKey).subarray(0, 16));
}

/** Groups a key id for a human to compare: `a1b2 c3d4 ...`. */
export function formatDeliveryKeyFingerprint(keyId: string): string {
  return keyId.replace(/(.{4})(?=.)/g, '$1 ');
}

export type DeliveryKeyPair = { keyId: string; publicKey: Uint8Array; privateKey: Uint8Array };

export async function generateDeliveryKeyPair(): Promise<DeliveryKeyPair> {
  const pair = await suite.kem.generateKeyPair();
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
  const privateKey = new Uint8Array(await suite.kem.serializePrivateKey(pair.privateKey));
  return { keyId: deliveryKeyId(publicKey), publicKey, privateKey };
}

/** Canonical plaintext: fixed key order, so the same address always encodes the same bytes. */
export function canonicalDeliveryAddressJson(address: CommerceDeliveryAddressValue): string {
  return JSON.stringify({
    name: address.name,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
  });
}

function padPlaintext(plaintext: Uint8Array): Uint8Array {
  if (plaintext.byteLength > DELIVERY_PLAINTEXT_BUCKET_BYTES - 1) {
    throw new DeliveryEnvelopeError(
      'address_too_long',
      'This address is too long to encrypt. Shorten it and try again.',
    );
  }
  const padded = new Uint8Array(DELIVERY_PLAINTEXT_BUCKET_BYTES);
  padded.set(plaintext, 0);
  padded[plaintext.byteLength] = PAD_DELIMITER;
  return padded;
}

function unpadPlaintext(padded: Uint8Array): Uint8Array {
  let end = padded.byteLength - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== PAD_DELIMITER) {
    throw new DeliveryEnvelopeError('bad_padding', 'The delivery address padding is invalid.');
  }
  return padded.subarray(0, end);
}

function requirePublicKey(publicKey: Uint8Array, keyId: string): void {
  if (deliveryKeyId(publicKey) !== keyId) {
    throw new DeliveryEnvelopeError('key_id_mismatch', 'The delivery key id does not match the delivery public key.');
  }
}

export async function sealDeliveryAddress(input: {
  address: CommerceDeliveryAddressValue;
  recipientPublicKey: Uint8Array;
  binding: DeliveryEnvelopeBinding;
}): Promise<string> {
  requirePublicKey(input.recipientPublicKey, input.binding.keyId);
  const aad = buildDeliveryAad(input.binding);
  const padded = padPlaintext(encoder.encode(canonicalDeliveryAddressJson(input.address)));
  const recipientPublicKey = await suite.kem.deserializePublicKey(input.recipientPublicKey as BufferSource);
  const sealed = await suite.seal(
    { recipientPublicKey, info: encoder.encode(DELIVERY_ENVELOPE_CONTEXT) },
    padded as BufferSource,
    aad as BufferSource,
  );
  const wire = new Uint8Array(HPKE_ENC_BYTES + sealed.ct.byteLength);
  wire.set(new Uint8Array(sealed.enc), 0);
  wire.set(new Uint8Array(sealed.ct), HPKE_ENC_BYTES);
  return bytesToBase64Url(wire);
}

export type SellerDeliveryKey = { keyId: string; publicKey: Uint8Array };

export type SellerDeliveryEnvelope = { sellerPubky: string; keyId: string; envelope: string };

/**
 * Seals one address once per seller, each envelope bound to the checkout
 * command id, the buyer, that seller and the key id used. The plaintext
 * address is not kept.
 */
export async function sealDeliveryAddressForSellers(input: {
  address: CommerceDeliveryAddressValue;
  checkoutCommandId: string;
  buyerPubky: string;
  keys: ReadonlyMap<string, SellerDeliveryKey>;
}): Promise<SellerDeliveryEnvelope[]> {
  return await Promise.all(
    [...input.keys].map(async ([sellerPubky, key]) => ({
      sellerPubky,
      keyId: key.keyId,
      envelope: await sealDeliveryAddress({
        address: input.address,
        recipientPublicKey: key.publicKey,
        binding: {
          checkoutCommandId: input.checkoutCommandId,
          buyerPubky: input.buyerPubky,
          sellerPubky,
          keyId: key.keyId,
        },
      }),
    })),
  );
}

/** Decodes and length-checks an envelope without any key. */
export function decodeDeliveryEnvelope(envelope: string): { enc: Uint8Array; ciphertext: Uint8Array } {
  let wire: Uint8Array;
  try {
    wire = base64UrlToBytes(envelope);
  } catch {
    throw new DeliveryEnvelopeError('malformed_envelope', 'The delivery address envelope is not valid base64url.');
  }
  if (wire.byteLength !== DELIVERY_ENVELOPE_BYTES || bytesToBase64Url(wire) !== envelope) {
    throw new DeliveryEnvelopeError('malformed_envelope', 'The delivery address envelope has the wrong size.');
  }
  return { enc: wire.subarray(0, HPKE_ENC_BYTES), ciphertext: wire.subarray(HPKE_ENC_BYTES) };
}

const openedAddressSchema = z
  .object({
    name: z.string(),
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    countryCode: z.string(),
  })
  .strict();

export async function openDeliveryAddress(input: {
  envelope: string;
  privateKey: Uint8Array;
  binding: DeliveryEnvelopeBinding;
}): Promise<CommerceDeliveryAddressValue> {
  const { enc, ciphertext } = decodeDeliveryEnvelope(input.envelope);
  const aad = buildDeliveryAad(input.binding);
  let padded: Uint8Array;
  try {
    const recipientKey = await suite.kem.deserializePrivateKey(input.privateKey as BufferSource);
    padded = new Uint8Array(
      await suite.open(
        { recipientKey, enc: enc as BufferSource, info: encoder.encode(DELIVERY_ENVELOPE_CONTEXT) },
        ciphertext as BufferSource,
        aad as BufferSource,
      ),
    );
  } catch {
    throw new DeliveryEnvelopeError('open_failed', 'This delivery address cannot be opened with this key.');
  }
  const plaintext = unpadPlaintext(padded);
  try {
    return openedAddressSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
  } catch {
    throw new DeliveryEnvelopeError('bad_padding', 'The delivery address content is invalid.');
  }
}

/** The public record a seller publishes at `delivery-keys/current`. */
export const deliveryKeyRecordSchema = z
  .object({
    v: z.literal(1),
    keyId: z.string().regex(DELIVERY_KEY_ID_PATTERN),
    publicKey: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type DeliveryKeyRecord = z.infer<typeof deliveryKeyRecordSchema>;

export function buildDeliveryKeyRecord(
  pair: Pick<DeliveryKeyPair, 'keyId' | 'publicKey'>,
  createdAt: Date,
): DeliveryKeyRecord {
  return {
    v: 1,
    keyId: pair.keyId,
    publicKey: bytesToBase64Url(pair.publicKey),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Validates a record read from a homeserver: strict shape, a 32-byte key, and
 * a `keyId` that is the derived id of that key. Returns the raw public key.
 */
export function parseDeliveryKeyRecord(raw: unknown): { record: DeliveryKeyRecord; publicKey: Uint8Array } | null {
  const parsed = deliveryKeyRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  let publicKey: Uint8Array;
  try {
    publicKey = base64UrlToBytes(parsed.data.publicKey);
    if (bytesToBase64Url(publicKey) !== parsed.data.publicKey) return null;
    if (deliveryKeyId(publicKey) !== parsed.data.keyId) return null;
  } catch {
    return null;
  }
  return { record: parsed.data, publicKey };
}

export function deliveryKeyRecordUrl(sellerPubky: string): string {
  return `pubky://${commercePubkySchema.parse(sellerPubky)}${DELIVERY_KEYS_PATH}${DELIVERY_KEY_CURRENT_FILE}`;
}
