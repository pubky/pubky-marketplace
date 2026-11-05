import { z } from 'zod';
import type { CommerceShippingOption } from '@/libs/commerce/marketplace-records';
import { amountInputToMoney, assetForListingCurrency, type CommerceAsset } from '@/libs/commerce/pricing';
import { shippingProfileFitsAsset, type ShippingProfileSnapshot } from '@/libs/commerce/shipping-profile';
import { legacyShippingOption, type ShippingZone } from '@/libs/commerce/shipping-zones';
import {
  type ShippingZoneFormValue,
  shippingZonesFromForm,
  shippingZonesToForm,
} from '@/libs/commerce/shipping-zones-form';

/** How a shipped listing is priced: one flat option, a shared profile, or zones of its own. */
export const listingShippingModeSchema = z.enum(['flat', 'profile', 'custom']);
export type ListingShippingMode = z.infer<typeof listingShippingModeSchema>;

/** The legacy option id a zone-priced listing carries for readers that predate zones. */
export const ZONE_LEGACY_OPTION_ID = 'zone_pricing';

/** The studio fields that decide a listing's shipping. */
export type ListingShippingForm = {
  shippingMode: ListingShippingMode;
  shippingProfileId: string;
  shippingZoneValues: ShippingZoneFormValue[];
  shippingLabel: string;
  freeShipping: boolean;
  shippingPrice: string;
  shippingMinDays: string;
  shippingMaxDays: string;
  currency: Parameters<typeof assetForListingCurrency>[0];
};

/** The members of a listing record that carry its shipping; every other member is left alone. */
export type ListingShippingRecordFields = {
  shippingOptions: CommerceShippingOption[];
  shippingProfileId: string | undefined;
  shippingZones: ShippingZone[] | undefined;
};

export type ListingShippingResult =
  | { ok: true; fields: ListingShippingRecordFields }
  | { ok: false; reason: 'profile-missing' | 'profile-currency' | 'zones-invalid'; errors: string[] };

function flatOption(data: ListingShippingForm, asset: CommerceAsset): CommerceShippingOption {
  const common = {
    id: 'seller_flat_rate',
    label: data.shippingLabel,
    estimatedMinDays: Number(data.shippingMinDays),
    estimatedMaxDays: Number(data.shippingMaxDays),
  };
  return data.freeShipping
    ? { ...common, pricing: 'free' }
    : { ...common, pricing: 'flat', price: amountInputToMoney(data.shippingPrice, asset) };
}

/**
 * The shipping members of a listing record for the studio's choice.
 *
 * A profile listing names the profile and carries the legacy flat option that
 * `legacyShippingOption` derives from the profile as read now, so a reader
 * that predates zones still shows a price. The profile must be in the
 * listing's currency: the service refuses a profile that prices in another
 * asset. A custom listing carries its own zones the same way.
 */
export function buildListingShipping(
  data: ListingShippingForm,
  profile: ShippingProfileSnapshot | null,
): ListingShippingResult {
  const asset = assetForListingCurrency(data.currency);
  if (data.shippingMode === 'flat') {
    return {
      ok: true,
      fields: { shippingOptions: [flatOption(data, asset)], shippingProfileId: undefined, shippingZones: undefined },
    };
  }
  if (data.shippingMode === 'profile') {
    if (profile === null || profile.record.profileId !== data.shippingProfileId) {
      return { ok: false, reason: 'profile-missing', errors: ['The shipping profile could not be read.'] };
    }
    if (!shippingProfileFitsAsset(profile.record, asset)) {
      return {
        ok: false,
        reason: 'profile-currency',
        errors: [`This profile prices in ${profile.record.currency}; the listing is priced in ${asset.currency}.`],
      };
    }
    const option = legacyShippingOption(profile.record.zones, asset, ZONE_LEGACY_OPTION_ID, profile.record.name);
    return {
      ok: true,
      fields: { shippingOptions: [option], shippingProfileId: profile.record.profileId, shippingZones: undefined },
    };
  }
  const zones = shippingZonesFromForm(data.shippingZoneValues, asset);
  if (!zones.ok) return { ok: false, reason: 'zones-invalid', errors: zones.errors };
  return {
    ok: true,
    fields: {
      shippingOptions: [legacyShippingOption(zones.zones, asset, ZONE_LEGACY_OPTION_ID, 'Shipping')],
      shippingProfileId: undefined,
      shippingZones: zones.zones,
    },
  };
}

/** The studio's shipping fields for a record being edited or duplicated. */
export function listingShippingFormFromRecord(
  record: { shippingProfileId?: string; shippingZones?: ShippingZone[] },
  asset: CommerceAsset,
): Pick<ListingShippingForm, 'shippingMode' | 'shippingProfileId' | 'shippingZoneValues'> | null {
  if (record.shippingProfileId !== undefined) {
    return { shippingMode: 'profile', shippingProfileId: record.shippingProfileId, shippingZoneValues: [] };
  }
  if (record.shippingZones !== undefined) {
    return {
      shippingMode: 'custom',
      shippingProfileId: '',
      shippingZoneValues: shippingZonesToForm(record.shippingZones, asset),
    };
  }
  return null;
}
