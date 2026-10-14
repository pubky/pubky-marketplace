import {
  COMMERCE_CONTRACT_VERSION,
  COMMERCE_SHOP_BIO_MAX_CHARS,
  COMMERCE_SHOP_NAME_MAX_CHARS,
} from '@/config/commerce';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { CommerceRecordNormalizer } from './commerce.normalizer';

/** Country published when neither a listing nor the seller says where the shop is (the settings form's default too). */
export const DEFAULT_SHOP_COUNTRY_CODE = 'US';

export interface DefaultShopInput {
  ownerPubky: string;
  /** The seller's published profile, if any (`ProfileApplication.readProfileSeed`). */
  profile: { name: string; bio: string } | null;
  /** Where the seller's listing ships from, when the trigger has one. */
  location?: CommerceShopRecord['location'];
  now: Date;
}

/**
 * The storefront the Shop publishes for a seller who can take bitcoin but never
 * saved shop settings. Built from the seller's profile and validated like any
 * shop record. Policies stay empty: the Shop never states terms the seller did
 * not write. The seller's first settings save replaces it (revision 2).
 */
export function buildDefaultShopRecord({ ownerPubky, profile, location, now }: DefaultShopInput): CommerceShopRecord {
  const timestamp = now.toISOString();
  const name = profile?.name.trim().slice(0, COMMERCE_SHOP_NAME_MAX_CHARS).trim() || `Shop ${ownerPubky.slice(0, 8)}`;
  return CommerceRecordNormalizer.shop({
    schemaVersion: COMMERCE_CONTRACT_VERSION,
    recordType: 'shop',
    ownerPubky,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    name,
    bio: profile?.bio.trim().slice(0, COMMERCE_SHOP_BIO_MAX_CHARS).trim() ?? '',
    location: location
      ? { countryCode: location.countryCode, ...(location.region ? { region: location.region } : {}) }
      : { countryCode: DEFAULT_SHOP_COUNTRY_CODE },
    shippingPolicy: '',
    returnPolicy: '',
    vacationMode: false,
  });
}
