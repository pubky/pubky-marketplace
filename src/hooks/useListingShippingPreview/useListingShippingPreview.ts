'use client';

import { useEffect, useMemo, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { listingZonePricing } from '@/libs/commerce/shipping-groups';
import { type ListingShippingPreview, previewListingShipping } from '@/libs/commerce/shipping-preview';
import { shippingProfileFitsAsset } from '@/libs/commerce/shipping-profile';
import type { ShippingZone } from '@/libs/commerce/shipping-zones';

export type ListingShippingPreviewState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'unreadable' }
  | { status: 'asset-mismatch' }
  | { status: 'ready'; preview: ListingShippingPreview };

type ProfileRead =
  | { key: string; zones: ShippingZone[]; excludedCountries: string[]; currency: string; exponent: number }
  | { key: string; failed: true };

/** The shipping a zone-priced listing shows its viewer; `none` for a listing priced by its flat options. */
export function useListingShippingPreview(
  record: Pick<CommerceListingRecord, 'ownerPubky' | 'shippingProfileId' | 'shippingZones'> | undefined,
  viewerCountry: string | null,
  asset: { currency: string; exponent: number } | null,
): ListingShippingPreviewState {
  const pricing = record ? listingZonePricing(record) : null;
  const profileKey = pricing?.kind === 'profile' && record ? `${record.ownerPubky}/${pricing.profileId}` : null;
  const [read, setRead] = useState<ProfileRead | null>(null);

  useEffect(() => {
    if (profileKey === null || !record || pricing?.kind !== 'profile') return;
    let active = true;
    CommerceController.fetchShippingProfile(record.ownerPubky, pricing.profileId)
      .then((snapshot) => {
        if (!active) return;
        setRead(
          snapshot
            ? {
                key: profileKey,
                zones: snapshot.record.zones,
                excludedCountries: snapshot.record.excludedCountries,
                currency: snapshot.record.currency,
                exponent: snapshot.record.exponent,
              }
            : { key: profileKey, failed: true },
        );
      })
      .catch(() => {
        if (active) setRead({ key: profileKey, failed: true });
      });
    return () => {
      active = false;
    };
    // The read is keyed by the profile; `record` and `pricing` are derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  const inlineZones = pricing?.kind === 'inline' ? pricing.zones : null;
  const current = read !== null && read.key === profileKey ? read : null;
  const zoned = pricing !== null;
  const assetCurrency = asset?.currency ?? null;
  const assetExponent = asset?.exponent ?? null;
  return useMemo<ListingShippingPreviewState>(() => {
    if (!zoned) return { status: 'none' };
    if (inlineZones !== null) {
      return { status: 'ready', preview: previewListingShipping(inlineZones, [], viewerCountry) };
    }
    if (current === null) return { status: 'loading' };
    if ('failed' in current) return { status: 'unreadable' };
    if (
      assetCurrency !== null &&
      assetExponent !== null &&
      !shippingProfileFitsAsset(current, { currency: assetCurrency, exponent: assetExponent })
    )
      return { status: 'asset-mismatch' };
    return {
      status: 'ready',
      preview: previewListingShipping(current.zones, current.excludedCountries, viewerCountry),
    };
  }, [zoned, inlineZones, current, viewerCountry, assetCurrency, assetExponent]);
}
