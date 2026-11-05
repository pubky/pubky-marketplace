import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  type CommerceShippingProfileRecord,
  commerceShippingProfileRecordSchema,
} from '@/libs/commerce/marketplace-records';
import type { ShippingZone } from '@/libs/commerce/shipping-zones';
import {
  COMMERCE_CONTRACT_VERSION,
  commerceEntityIdSchema,
  commercePubkySchema,
} from '@/libs/commerce/transaction-contracts';

/** The transaction service reads at most this many bytes of a profile record. */
export const SHIPPING_PROFILE_MAX_BYTES = 1024 * 1024;

/** Profiles a seller may keep; the settings editor stops here, well under any directory listing bound. */
export const SHIPPING_PROFILE_MAX_COUNT = 50;

const PROFILE_PATH = '/pub/pubky.app/marketplace/v1/shipping_profiles/';

export function shippingProfileDirectoryUri(ownerPubky: string): string {
  return `pubky://${commercePubkySchema.parse(ownerPubky)}${PROFILE_PATH}`;
}

export function shippingProfileUri(ownerPubky: string, profileId: string): string {
  return `${shippingProfileDirectoryUri(ownerPubky)}${commerceEntityIdSchema.parse(profileId)}`;
}

/** The profile id at the end of a profile URI the homeserver listed, or null for anything else. */
export function shippingProfileIdFromUri(uri: string): string | null {
  const id = uri.slice(uri.lastIndexOf('/') + 1);
  return uri.includes(PROFILE_PATH) && commerceEntityIdSchema.safeParse(id).success ? id : null;
}

/**
 * SHA-256 (lowercase hex) of a profile record's exact bytes as the
 * homeserver serves them. The transaction service pins a checkout to this
 * digest, so it is always taken from the bytes read, never from a
 * re-serialized record.
 */
export function shippingProfileSha256(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** A profile as read: the record and the digest of the bytes it was parsed from. */
export type ShippingProfileSnapshot = {
  record: CommerceShippingProfileRecord;
  sha256: string;
};

/**
 * Parses profile bytes read at `shipping_profiles/{profileId}` of `ownerPubky`.
 * A record that does not describe that path is refused, so a profile copied
 * from another seller or id never prices an order.
 */
export function parseShippingProfileBytes(
  bytes: Uint8Array,
  ownerPubky: string,
  profileId: string,
): ShippingProfileSnapshot {
  if (bytes.byteLength > SHIPPING_PROFILE_MAX_BYTES) throw new TypeError('The shipping profile is too large.');
  const record = commerceShippingProfileRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (record.ownerPubky !== ownerPubky || record.profileId !== profileId) {
    throw new TypeError('The shipping profile does not match its path.');
  }
  return { record, sha256: shippingProfileSha256(bytes) };
}

/** The asset a listing is priced in, which a profile must share to price it. */
export function shippingProfileFitsAsset(
  profile: Pick<CommerceShippingProfileRecord, 'currency' | 'exponent'>,
  asset: { currency: string; exponent: number },
): boolean {
  return profile.currency === asset.currency && profile.exponent === asset.exponent;
}

export type ShippingProfileInput = {
  name: string;
  currency: string;
  exponent: number;
  origins: string[];
  excludedCountries: string[];
  zones: ShippingZone[];
};

/**
 * The record to publish for an edit of `existing` (revision advanced, members
 * this client does not know kept) or for a new profile.
 */
export function buildShippingProfileRecord(
  ownerPubky: string,
  profileId: string,
  input: ShippingProfileInput,
  existing: CommerceShippingProfileRecord | null,
  now: Date,
): CommerceShippingProfileRecord {
  const timestamp = now.toISOString();
  return commerceShippingProfileRecordSchema.parse({
    ...existing,
    schemaVersion: COMMERCE_CONTRACT_VERSION,
    recordType: 'shipping_profile',
    ownerPubky,
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    profileId,
    ...input,
  });
}
