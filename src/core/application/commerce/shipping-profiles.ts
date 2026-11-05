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
import { hasHttpStatus } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';

export type ShippingProfileListing = {
  profiles: ShippingProfileSnapshot[];
  /** Profile files that are listed but cannot be read as a profile, so the editor can say so instead of hiding them. */
  unreadable: string[];
};

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
    return { profiles, unreadable };
  }

  /** Publishes the profile and returns it as read back, so the digest is of the stored bytes. */
  static async put(record: CommerceShippingProfileRecord): Promise<ShippingProfileSnapshot> {
    await CommerceHomeserverService.putJson(shippingProfileUri(record.ownerPubky, record.profileId), { ...record });
    const stored = await this.fetch(record.ownerPubky, record.profileId);
    if (!stored) throw new Error('The shipping profile was not found after it was saved.');
    return stored;
  }

  static async delete(ownerPubky: string, profileId: string): Promise<void> {
    await CommerceHomeserverService.delete(shippingProfileUri(ownerPubky, profileId));
  }
}
