import type { CommerceShippingProfileRecord } from '@/libs/commerce/marketplace-records';
import {
  parseShippingProfileBytes,
  SHIPPING_PROFILE_MAX_BYTES,
  SHIPPING_PROFILE_MAX_COUNT,
  shippingProfileDirectoryUri,
  shippingProfileIdFromUri,
  type ShippingProfileSnapshot,
  shippingProfileUri,
} from '@/libs/commerce/shipping-profile';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { hasHttpStatus } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';

export type ShippingProfileListing = {
  profiles: ShippingProfileSnapshot[];
  /** Profile files that are listed but cannot be read as a profile, so the editor can say so instead of hiding them. */
  unreadable: string[];
  /** True when the directory holds more entries than one bounded listing returns, so the counts below are a floor. */
  truncated: boolean;
};

const LISTING_READ_CONCURRENCY = 8;
const LISTING_MAX_BYTES = 1024 * 1024;
const LISTINGS_PATH = '/pub/pubky.app/marketplace/v1/listings/';

/**
 * A seller's shipping profiles at `shipping_profiles/{profileId}` on their
 * homeserver. They are read straight from the homeserver, never from a local
 * copy: the transaction service pins an order to the SHA-256 of the exact
 * bytes it reads there, so the digest the buyer is shown has to come from the
 * same bytes.
 */
export class CommerceShippingProfilesApplication {
  private constructor() {}

  /** One profile with the digest of its bytes, or null when the seller has none by that id. */
  static async fetch(ownerPubky: string, profileId: string): Promise<ShippingProfileSnapshot | null> {
    const url = shippingProfileUri(ownerPubky, profileId);
    let bytes: Uint8Array;
    try {
      bytes = await CommerceHomeserverService.getBytes(url, SHIPPING_PROFILE_MAX_BYTES);
    } catch (error) {
      if (hasHttpStatus(error, 404)) return null;
      throw error;
    }
    return parseShippingProfileBytes(bytes, ownerPubky, profileId);
  }

  static async list(ownerPubky: string): Promise<ShippingProfileListing> {
    const urls = await CommerceHomeserverService.list(
      shippingProfileDirectoryUri(ownerPubky),
      SHIPPING_PROFILE_MAX_COUNT + 1,
    );
    const profiles: ShippingProfileSnapshot[] = [];
    const unreadable: string[] = [];
    for (const url of urls) {
      const profileId = shippingProfileIdFromUri(url);
      if (profileId === null) continue;
      try {
        const snapshot = await this.fetch(ownerPubky, profileId);
        if (snapshot) profiles.push(snapshot);
      } catch (error) {
        Logger.warn('A shipping profile could not be read', { error });
        unreadable.push(profileId);
      }
    }
    return { profiles, unreadable, truncated: urls.length > SHIPPING_PROFILE_MAX_COUNT };
  }

  /**
   * How many of the seller's live listings name `profileId`, read from the listing records on their
   * homeserver (the canonical copy, so a listing published from another device or not yet indexed counts).
   * Any listing that cannot be read rejects: a delete must never proceed on a partial answer.
   */
  static async countListingsUsing(ownerPubky: string, profileId: string): Promise<number> {
    const directory = `pubky://${commercePubkySchema.parse(ownerPubky)}${LISTINGS_PATH}`;
    const urls = await CommerceHomeserverService.listAll(directory);
    let inUse = 0;
    for (let start = 0; start < urls.length; start += LISTING_READ_CONCURRENCY) {
      const results = await Promise.all(
        urls.slice(start, start + LISTING_READ_CONCURRENCY).map(async (url) => {
          const bytes = await CommerceHomeserverService.getBytes(url, LISTING_MAX_BYTES).catch((error: unknown) => {
            if (hasHttpStatus(error, 404)) return null;
            throw error;
          });
          if (bytes === null) return false;
          const record: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (typeof record !== 'object' || record === null || Array.isArray(record))
            throw new TypeError('A listing record is not an object.');
          const { shippingProfileId, state } = record as { shippingProfileId?: unknown; state?: unknown };
          return shippingProfileId === profileId && state !== 'removed';
        }),
      );
      inUse += results.filter(Boolean).length;
    }
    return inUse;
  }

  /** Publishes the profile and returns it as read back, so the digest is of the stored bytes. */
  static async put(record: CommerceShippingProfileRecord): Promise<ShippingProfileSnapshot> {
    // The service and the Shop both refuse to read more than this, so a larger record would be stored and then unreadable.
    if (new TextEncoder().encode(JSON.stringify({ ...record })).byteLength > SHIPPING_PROFILE_MAX_BYTES) {
      throw new TypeError('The shipping profile is too large.');
    }
    await CommerceHomeserverService.putJson(shippingProfileUri(record.ownerPubky, record.profileId), { ...record });
    const stored = await this.fetch(record.ownerPubky, record.profileId);
    if (!stored) throw new Error('The shipping profile was not found after it was saved.');
    return stored;
  }

  static async delete(ownerPubky: string, profileId: string): Promise<void> {
    await CommerceHomeserverService.delete(shippingProfileUri(ownerPubky, profileId));
  }
}
