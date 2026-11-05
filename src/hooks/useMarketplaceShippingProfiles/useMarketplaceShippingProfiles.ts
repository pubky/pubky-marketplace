'use client';

import { useCallback, useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  buildShippingProfileRecord,
  SHIPPING_PROFILE_MAX_COUNT,
  type ShippingProfileInput,
  type ShippingProfileSnapshot,
} from '@/libs/commerce/shipping-profile';
import { newShippingId } from '@/libs/commerce/shipping-zones-form';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';

export type MarketplaceShippingProfilesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profiles: ShippingProfileSnapshot[]; unreadable: string[] };

/**
 * How many of the seller's own listings name `profileId`, after refreshing
 * the seller's listings from the network so one published from another device
 * counts. A profile in use is not deleted: its listings would stop shipping.
 */
export async function countListingsUsingProfile(ownerPubky: string, profileId: string): Promise<number> {
  await CommerceController.refreshListingsBySeller(ownerPubky);
  const listings = await CommerceController.getListingsBySeller(ownerPubky);
  return listings.filter(({ record }) => record.shippingProfileId === profileId && record.state !== 'removed').length;
}

/**
 * The seller's profiles as they are now, read from the homeserver, for an
 * import that must price against the profile it names. A read that fails is
 * an empty list, so the import asks for a shipping choice instead of
 * guessing.
 */
export async function readShippingProfilesNow(ownerPubky: string): Promise<ShippingProfileSnapshot[]> {
  try {
    return (await CommerceController.listShippingProfiles(ownerPubky)).profiles;
  } catch {
    return [];
  }
}

/** The signed-in seller's shipping profiles, read from their homeserver, with save and delete. */
export function useMarketplaceShippingProfiles() {
  const ownerPubky = useAuthStore((state) => state.currentUserPubky);
  const [state, setState] = useState<MarketplaceShippingProfilesState>({ status: 'loading' });

  const reload = useCallback(async () => {
    if (!ownerPubky) return;
    try {
      const { profiles, unreadable } = await CommerceController.listShippingProfiles(ownerPubky);
      setState({ status: 'ready', profiles, unreadable });
    } catch {
      setState({ status: 'error' });
    }
  }, [ownerPubky]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (profileId: string | null, input: ShippingProfileInput): Promise<boolean> => {
    if (!ownerPubky) return false;
    const existing =
      profileId === null || state.status !== 'ready'
        ? null
        : (state.profiles.find(({ record }) => record.profileId === profileId)?.record ?? null);
    if (profileId === null && state.status === 'ready' && state.profiles.length >= SHIPPING_PROFILE_MAX_COUNT) {
      toast({ variant: 'error', description: `You can keep up to ${SHIPPING_PROFILE_MAX_COUNT} shipping profiles.` });
      return false;
    }
    try {
      const record = buildShippingProfileRecord(ownerPubky, profileId ?? newShippingId(), input, existing, new Date());
      await CommerceController.putShippingProfile(record);
      toast({ title: 'Shipping profile saved', description: `"${record.name}" is ready to use on your listings.` });
      await reload();
      return true;
    } catch {
      toast({ variant: 'error', description: 'The shipping profile could not be saved. Try again.' });
      return false;
    }
  };

  const remove = async (profileId: string): Promise<boolean> => {
    if (!ownerPubky) return false;
    try {
      const inUse = await countListingsUsingProfile(ownerPubky, profileId);
      if (inUse > 0) {
        toast({
          variant: 'error',
          description: `${inUse === 1 ? 'A listing uses' : `${inUse} listings use`} this profile. Move ${inUse === 1 ? 'it' : 'them'} to another profile first.`,
        });
        return false;
      }
      await CommerceController.deleteShippingProfile(ownerPubky, profileId);
      await reload();
      return true;
    } catch {
      toast({ variant: 'error', description: 'The shipping profile could not be deleted. Try again.' });
      return false;
    }
  };

  return { state, reload, save, remove };
}
