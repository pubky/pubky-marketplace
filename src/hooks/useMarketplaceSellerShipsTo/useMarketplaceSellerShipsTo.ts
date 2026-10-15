'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import {
  destinationCountryError,
  SHIPS_TO_ANYWHERE,
  SHIPS_TO_LOADING,
  type ShipsToDestinations,
  shipsToDestinations,
  shopShipsToCountries,
} from '@/libs/commerce/ships-to';
import { hasHttpStatus } from '@/libs/error/error.utils';

/**
 * One seller's destination countries from their live shop record, falling
 * back to the cached copy when the network read fails. Null means anywhere
 * (no list, or no shop record at all); undefined means neither copy could be
 * read, so the destination cannot be confirmed.
 */
export async function resolveSellerShipsTo(sellerPubky: string): Promise<readonly string[] | null | undefined> {
  let record: CommerceShopRecord;
  try {
    record = await CommerceController.refreshShop(sellerPubky);
  } catch (error) {
    if (hasHttpStatus(error, 404)) return null;
    const cached = await CommerceController.getShop(sellerPubky).catch(() => null);
    if (!cached) return undefined;
    record = cached.record;
  }
  return shopShipsToCountries(record);
}

/** {@link resolveSellerShipsTo} for every seller, combined into one checkout's destinations. */
export async function resolveShipsToDestinations(sellerPubkys: readonly string[]): Promise<ShipsToDestinations> {
  const unique = [...new Set(sellerPubkys)];
  if (unique.length === 0) return SHIPS_TO_ANYWHERE;
  const lists = await Promise.all(unique.map((pubky) => resolveSellerShipsTo(pubky).catch(() => undefined)));
  return shipsToDestinations(lists);
}

/**
 * The last check before a delivery address is sealed to these sellers: reads
 * their shop records fresh and returns the refusal to show, or null when the
 * country is allowed. The sealed address is opaque to the transaction
 * service, so this is the only place the destination can be checked.
 */
export async function checkDestinationCountry(
  countryCode: string,
  sellerPubkys: readonly string[],
): Promise<string | null> {
  return destinationCountryError(countryCode, await resolveShipsToDestinations(sellerPubkys));
}

/**
 * Where a delivery address for these shipped sellers may be. Loading until
 * every seller's shop record has been read.
 */
export function useMarketplaceSellerShipsTo(sellerPubkys: readonly string[]): ShipsToDestinations {
  const key = [...new Set(sellerPubkys)].sort().join(',');
  const [resolved, setResolved] = useState<{ key: string; destinations: ShipsToDestinations } | null>(null);

  useEffect(() => {
    if (key === '') return;
    let active = true;
    void resolveShipsToDestinations(key.split(',')).then((destinations) => {
      if (active) setResolved({ key, destinations });
    });
    return () => {
      active = false;
    };
  }, [key]);

  if (key === '') return SHIPS_TO_ANYWHERE;
  return resolved?.key === key ? resolved.destinations : SHIPS_TO_LOADING;
}
