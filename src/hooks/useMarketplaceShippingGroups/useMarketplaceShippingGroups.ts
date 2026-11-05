'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { type MarketplaceCartItem, priceForCartItem } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { canonicalCountryCode } from '@/libs/commerce/postal-address';
import {
  groupOptions,
  type GroupRateCard,
  listingZonePricing,
  selectedRateId,
  type ShippingChoicePayload,
  shippingChoicePayload,
  type ShippingGroup,
  shippingGroups,
  type ZonedLine,
} from '@/libs/commerce/shipping-groups';
import { shippingProfileFitsAsset } from '@/libs/commerce/shipping-profile';
import type { ShippingQuote, ShippingQuoteErrorCode } from '@/libs/commerce/shipping-zones';

export type ShippingMoney = { amountMinor: number; currency: string; exponent: number };

export type ShippingGroupView = {
  key: string;
  sellerPubky: string;
  /** What names the group to the buyer: the profile's name, or the listing's title. */
  label: string;
  units: number;
  /** The asset the group's lines are priced in. */
  asset: { currency: string; exponent: number };
  state:
    | { status: 'loading' }
    | { status: 'unreadable' }
    | { status: 'asset-mismatch' }
    | { status: 'needs-destination' }
    | { status: 'refused'; code: ShippingQuoteErrorCode }
    | { status: 'ready'; quotes: ShippingQuote[]; selectedRateId: string; amount: ShippingMoney };
};

type CardState =
  | { status: 'loading' }
  | { status: 'unreadable'; generation: number }
  | {
      status: 'ready';
      card: GroupRateCard;
      name: string;
      asset?: { currency: string; exponent: number };
      generation: number;
    };

const DESTINATION = /^[A-Z]{2}$/;

/** The shipped lines whose listings are priced by zones, grouped the way the service groups them. */
export function zonedLinesOf(items: readonly MarketplaceCartItem[]): ZonedLine[] {
  return items.map((item) => ({
    id: item.id,
    sellerPubky: item.listing.record.ownerPubky,
    listingId: item.listing.record.listingId,
    quantity: item.quantity,
    pricing: listingZonePricing(item.listing.record),
  }));
}

/**
 * The buyer's shipping rates for the zone-priced groups of a checkout.
 *
 * Each group is priced from the profile read now (pinned by the digest of
 * the bytes read) or from the listing's own zones, for the destination
 * country the address form holds. The buyer's pick per group survives
 * re-reads while it still exists; otherwise the cheapest rate is chosen.
 * Lines that are not zone-priced belong to no group and keep their flat
 * rate.
 */
export function useMarketplaceShippingGroups(shippedItems: readonly MarketplaceCartItem[], destinationInput: string) {
  const destination = canonicalCountryCode(destinationInput);
  const groups = useMemo(() => shippingGroups(zonedLinesOf(shippedItems)), [shippedItems]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [reads, setReads] = useState(0);

  const readKey = groups.map((group) => group.key).join('|');
  useEffect(() => {
    let active = true;
    const generation = reads;
    const wanted = groups.filter((group) => group.profileId !== undefined);
    for (const group of wanted) {
      void CommerceController.fetchShippingProfile(group.sellerPubky, group.profileId)
        .then((snapshot) => {
          if (!active) return;
          setCards((current) => ({
            ...current,
            [group.key]: snapshot
              ? {
                  status: 'ready',
                  generation,
                  name: snapshot.record.name,
                  asset: { currency: snapshot.record.currency, exponent: snapshot.record.exponent },
                  card: {
                    zones: snapshot.record.zones,
                    excludedCountries: snapshot.record.excludedCountries,
                    profileSha256: snapshot.sha256,
                  },
                }
              : { status: 'unreadable', generation },
          }));
        })
        .catch(() => {
          if (active) setCards((current) => ({ ...current, [group.key]: { status: 'unreadable', generation } }));
        });
    }
    return () => {
      active = false;
    };
    // `groups` is derived from `readKey`; a re-read is requested by `reads`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, reads]);

  const cardFor = useCallback(
    (group: ShippingGroup): CardState => {
      if (group.zones !== undefined) {
        return { status: 'ready', card: { zones: group.zones, excludedCountries: [] }, name: '', generation: reads };
      }
      const read = cards[group.key];
      // A read older than the latest refresh describes rates the service may have replaced.
      return read === undefined || ('generation' in read && read.generation !== reads) ? { status: 'loading' } : read;
    },
    [cards, reads],
  );

  const views = useMemo<ShippingGroupView[]>(
    () =>
      groups.map((group) => {
        const first = shippedItems.find((item) => group.lineIds.includes(item.id));
        const price = first ? priceForCartItem(first) : null;
        const asset = { currency: price?.currency ?? '', exponent: price?.exponent ?? 0 };
        const card = cardFor(group);
        const label =
          card.status === 'ready' && card.name !== '' ? card.name : (first?.listing.record.title ?? 'Shipping');
        const view = (state: ShippingGroupView['state']): ShippingGroupView => ({
          key: group.key,
          sellerPubky: group.sellerPubky,
          label,
          units: group.units,
          asset,
          state,
        });
        if (card.status !== 'ready') return view({ status: card.status });
        if (card.asset !== undefined) {
          const profileAsset = card.asset;
          const fits = shippedItems
            .filter((item) => group.lineIds.includes(item.id))
            .every((item) => {
              const line = priceForCartItem(item);
              return line !== null && shippingProfileFitsAsset(profileAsset, line);
            });
          if (!fits) return view({ status: 'asset-mismatch' });
        }
        if (!DESTINATION.test(destination)) return view({ status: 'needs-destination' });
        const options = groupOptions(group, card.card, destination);
        if (options.status === 'refused') return view({ status: 'refused', code: options.code });
        const rateId = selectedRateId(options.quotes, picked[group.key]);
        const quote = options.quotes.find((candidate) => candidate.rateId === rateId);
        if (rateId === undefined || quote === undefined)
          return view({ status: 'refused', code: 'UNKNOWN_SHIPPING_RATE' });
        return view({
          status: 'ready',
          quotes: options.quotes,
          selectedRateId: rateId,
          amount: { amountMinor: quote.amountMinor, ...asset },
        });
      }),
    [groups, shippedItems, cardFor, destination, picked],
  );

  const setRate = useCallback((groupKey: string, rateId: string) => {
    setPicked((current) => ({ ...current, [groupKey]: rateId }));
  }, []);

  /** Reads every profile again, as after the service says one changed. */
  const refresh = useCallback(() => setReads((count) => count + 1), []);

  /** The rate choices the checkout command carries, or why the order cannot be priced yet. */
  const choices = ():
    | { ok: true; choices: ShippingChoicePayload[] }
    | { ok: false; reason: ShippingGroupView['state']['status'] } => {
    const payload: ShippingChoicePayload[] = [];
    for (const view of views) {
      if (view.state.status !== 'ready') return { ok: false, reason: view.state.status };
      const group = groups.find(({ key }) => key === view.key) as ShippingGroup;
      const card = cardFor(group);
      if (card.status !== 'ready') return { ok: false, reason: card.status };
      payload.push(shippingChoicePayload(group, view.state.selectedRateId, card.card));
    }
    return { ok: true, choices: payload };
  };

  /** What the zone-priced groups add to the order, per asset. */
  const amounts: ShippingMoney[] = [];
  for (const { state } of views) {
    if (state.status !== 'ready') continue;
    const existing = amounts.find(
      (money) => money.currency === state.amount.currency && money.exponent === state.amount.exponent,
    );
    if (existing) existing.amountMinor += state.amount.amountMinor;
    else amounts.push({ ...state.amount });
  }

  return {
    groups: views,
    hasZonedGroups: groups.length > 0,
    zonedItemIds: new Set(groups.flatMap((group) => group.lineIds)),
    amounts,
    setRate,
    refresh,
    choices,
  };
}
