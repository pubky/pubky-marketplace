import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceCartItem } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { SHIPPING_CHANGED_MESSAGE } from '@/libs/commerce/failure-messages';
import { commerceListingShippingMinor } from '@/libs/commerce/marketplace-records';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import type { ShippingProfileSnapshot } from '@/libs/commerce/shipping-profile';
import { toast } from '@/molecules/Toaster/use-toast';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceCheckout } from './useMarketplaceCheckout';

const listing = createCommerceSandboxCatalog().listings.find(({ sale }) => sale.format === 'fixed_price')!;
const price = listing.sale.format === 'fixed_price' ? listing.sale.unitPrice : listing.sale.startingPrice;
const shipping = { ...price, amountMinor: commerceListingShippingMinor(listing.shippingOptions) };
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);

function cartItem(record: Record<string, unknown>, quantity: number): MarketplaceCartItem {
  return {
    id: 'cart-item',
    listingId: `${listing.ownerPubky}:${listing.listingId}`,
    variantId: listing.variants[0].id,
    quantity,
    listing: {
      id: `${listing.ownerPubky}:${listing.listingId}`,
      seller_id: listing.ownerPubky,
      listing_id: listing.listingId,
      record: { ...listing, fulfillmentMethods: ['physical' as const], ...record },
      revision: 1,
      state: 'active',
      category_id: listing.categoryId,
      format: listing.sale.format,
      currency: price.currency,
      price_minor: price.amountMinor,
      sync_status: 'synced',
      updated_at: Date.parse(listing.updatedAt),
    },
  } as MarketplaceCartItem;
}

function snapshot(
  sha256: string,
  rates: Record<string, unknown>[],
  profile: { countries?: string[]; currency?: string; exponent?: number } = {},
): ShippingProfileSnapshot {
  return asOpaque<ShippingProfileSnapshot>({
    sha256,
    record: {
      schemaVersion: 1,
      recordType: 'shipping_profile',
      ownerPubky: listing.ownerPubky,
      revision: 1,
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      profileId: 'worldwide',
      name: 'Worldwide',
      currency: profile.currency ?? price.currency,
      exponent: profile.exponent ?? price.exponent,
      origins: ['US'],
      excludedCountries: [],
      zones: [{ zoneId: 'eu', name: 'Europe', countries: profile.countries ?? ['DE', 'FR'], rates }],
    },
  });
}

const standard = (firstMinor: number, additionalMinor: number) => ({
  pricing: 'per_item',
  rateId: 'std',
  label: 'Standard',
  estimatedMinDays: 6,
  estimatedMaxDays: 12,
  firstMinor,
  additionalMinor,
});
const express = {
  pricing: 'flat',
  rateId: 'exp',
  label: 'Express',
  estimatedMinDays: 2,
  estimatedMaxDays: 4,
  amountMinor: 2500,
};

const served = vi.hoisted(() => ({ profile: null as unknown, failing: false }));

const config = vi.hoisted(() => ({ mode: 'sandbox' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => config.mode, getPaykitServerApi: () => 'fork' };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    fetchShippingProfile: vi.fn(async () => {
      if (served.failing) throw new Error('offline');
      return served.profile;
    }),
    refreshShop: vi.fn(async (sellerPubky: string) => ({ ownerPubky: sellerPubky })),
    getShop: vi.fn(async () => null),
    getMarketplaceListingProjection: vi.fn(),
    syncListingRegistration: vi.fn(),
    refreshListing: vi.fn(async () => undefined),
    executeMarketplaceCommand: vi.fn(),
    fetchPickupAvailable: vi.fn(async () => true),
    fetchDigitalDeliveryCapability: vi.fn(async () => ({ available: true, maxBytes: null })),
    commitCreateMarketplaceCheckout: vi.fn(),
    setBuyerCountry: vi.fn(),
    getShippedSellers: vi.fn(),
    resolveDeliveryKeysForCheckout: vi.fn(),
    commitAcceptDeliveryKeyChange: vi.fn(),
    getDeliveryAddresses: vi.fn(async () => []),
    commitUpsertDeliveryAddress: vi.fn(async () => {}),
    commitMarkDeliveryAddressUsed: vi.fn(async () => {}),
    hasActiveMarketplaceSession: vi.fn(() => false),
    clearMarketplaceSession: vi.fn(),
    clearIdentitySession: vi.fn(),
    bindPaymentMethod: vi.fn(),
    getMarketplaceOrders: vi.fn(async () => []),
    getConnectorStores: vi.fn(async () => new Map()),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

const authMock = vi.hoisted(() => ({ currentUserPubky: null as string | null }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: authMock.currentUserPubky }),
}));

const SELLER_KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32).fill(7) };
const CHECKOUT_OK = {
  ok: true as const,
  version: 1 as const,
  commandId: '00000000-0000-4000-8000-000000001100',
  aggregateId: 'checkout:00000000-0000-4000-8000-000000001100',
  revision: 1,
  eventIds: ['00000000-0000-4000-8000-000000001101'],
  result: { kind: 'checkout' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  served.profile = snapshot(SHA_A, [standard(899, 450), express]);
  served.failing = false;
  config.mode = 'sandbox';
  authMock.currentUserPubky = null;
  useCommerceStore.setState({ marketplaceSession: null });
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000001100');
  vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
    aggregateId: `listing:${listing.ownerPubky}_${listing.listingId}`,
    sellerPubky: listing.ownerPubky,
    listingId: listing.listingId,
    listingRevision: listing.revision,
    contentHash: listing.media[0].contentHash,
    serverRevision: 1,
    state: 'available',
    availableQuantity: 5,
    reservedQuantity: 0,
    unitPrice: price,
    shipping,
    saleFormat: 'fixed_price',
    fulfillmentMethods: ['shipping'],
    auction: null,
  });
  vi.mocked(CommerceController.getShippedSellers).mockReturnValue([listing.ownerPubky]);
  vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
    ok: true,
    keys: new Map([[listing.ownerPubky, SELLER_KEY]]),
  });
  vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue(CHECKOUT_OK);
});

function mount(item: MarketplaceCartItem, countryCode: string) {
  const hook = renderHook(() =>
    useMarketplaceCheckout(
      [item],
      vi.fn(async () => {}),
    ),
  );
  act(() => {
    hook.result.current.form.setValue('name', 'Alice Buyer');
    hook.result.current.form.setValue('line1', '1 Market Street');
    hook.result.current.form.setValue('city', 'Berlin');
    hook.result.current.form.setValue('region', 'Region');
    hook.result.current.form.setValue('postalCode', '10115');
    hook.result.current.form.setValue('countryCode', countryCode);
  });
  return hook;
}

const group = (result: { current: ReturnType<typeof useMarketplaceCheckout> }) => result.current.zoneShipping.groups[0];
const sent = (call = 0) => vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[call]?.[0];

describe('useMarketplaceCheckout with zone-priced shipping', () => {
  const profileItem = () => cartItem({ shippingProfileId: 'worldwide' }, 2);

  it('prices the group for the address country and sends the destination and the pinned choice', async () => {
    const { result } = mount(profileItem(), 'de');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));

    expect(result.current.zoneShipping.amounts).toEqual([
      { amountMinor: 899 + 450, currency: price.currency, exponent: price.exponent },
    ]);
    await act(async () => {
      await result.current.submit();
    });

    expect(sent()).toMatchObject({
      destinationCountry: 'DE',
      shippingChoices: [
        { sellerPubky: listing.ownerPubky, profileId: 'worldwide', rateId: 'std', profileSha256: SHA_A },
      ],
    });
  });

  it('prices a UK address against a GB zone and sends the canonical country', async () => {
    served.profile = snapshot(SHA_A, [standard(899, 450)], { countries: ['GB'] });
    const { result } = mount(profileItem(), 'uk');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));

    await act(async () => {
      await result.current.submit();
    });

    expect(sent()).toMatchObject({ destinationCountry: 'GB' });
  });

  it('sends nothing when the profile prices in another currency than the item', async () => {
    served.profile = snapshot(SHA_A, [standard(899, 450)], { currency: price.currency === 'EUR' ? 'USD' : 'EUR' });
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('asset-mismatch'));

    expect(result.current.zoneShipping.amounts).toEqual([]);
    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('different currency') }),
    );
  });

  it('sends nothing for the old quote while the profile is read again after SHIPPING_CHANGED', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValueOnce({
      ok: false,
      error: { code: 'SHIPPING_CHANGED', message: 'The shipping profile changed.' },
    } as never);
    let finishRead: (value: unknown) => void = () => {};
    vi.mocked(CommerceController.fetchShippingProfile).mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)) as never,
    );

    await act(async () => {
      await result.current.submit();
    });
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(1);
    expect(group(result)?.state.status).toBe('loading');

    await act(async () => {
      await result.current.submit();
    });
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(1);

    await act(async () => finishRead(snapshot(SHA_B, [standard(999, 500)])));
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    await act(async () => {
      await result.current.submit();
    });
    expect(sent(1)?.shippingChoices?.[0]).toMatchObject({ profileSha256: SHA_B });
  });

  it('sends one checkout when Pay and submit are triggered in the same tick', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    let finish: (value: typeof CHECKOUT_OK) => void = () => {};
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)) as never,
    );

    let outcomes: unknown[] = [];
    await act(async () => {
      const first = result.current.pay(null);
      const second = result.current.submit();
      const third = result.current.pay(null);
      await waitFor(() => expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(1));
      finish(CHECKOUT_OK);
      outcomes = await Promise.all([first, second, third]);
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(1);
    expect(outcomes[1]).toBe(false);
    expect(outcomes[2]).toMatchObject({ ok: false });
  });

  it('ignores a rate change while a checkout is in flight, so the price shown is the price sent', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'exp'));
    let finish: (value: typeof CHECKOUT_OK) => void = () => {};
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)) as never,
    );

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current.pay(null);
      await waitFor(() => expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(1));
    });
    expect(result.current.checkoutBusy).toBe(true);

    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'std'));
    expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(2500);

    await act(async () => {
      finish(CHECKOUT_OK);
      await pending;
    });
    expect(result.current.checkoutBusy).toBe(false);
    expect(sent()?.shippingChoices?.[0]).toMatchObject({ rateId: 'exp' });

    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'std'));
    expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(1349);
  });

  it('sends the destination a flat-priced seller limits, even when the first read of the limit has not returned', async () => {
    vi.mocked(CommerceController.refreshShop)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ ownerPubky: listing.ownerPubky, shipsToCountries: ['DE'] } as never);
    const { result } = mount(cartItem({}, 1), 'DE');

    await act(async () => {
      await result.current.submit();
    });

    expect(sent()).toMatchObject({ destinationCountry: 'DE' });
    expect(sent()).not.toHaveProperty('shippingChoices');
  });

  it('seals the canonical country in the delivery address as well as sending it as the destination', async () => {
    served.profile = snapshot(SHA_A, [standard(899, 450)], { countries: ['GB'] });
    const { result } = mount(profileItem(), 'uk');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));

    await act(async () => {
      await result.current.submit();
    });

    expect(sent()).toMatchObject({ destinationCountry: 'GB', deliveryAddress: { countryCode: 'GB' } });
  });

  it('sends the rate the buyer picked', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'exp'));
    expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(2500);

    await act(async () => {
      await result.current.submit();
    });

    expect(sent()?.shippingChoices?.[0]).toMatchObject({ rateId: 'exp', profileSha256: SHA_A });
  });

  it('keeps the quote the buyer saw when the seller changes the profile before Pay, and re-quotes after the refusal', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'exp'));

    // The seller republishes with different prices after the buyer saw 25.00 and before Pay.
    served.profile = snapshot(SHA_B, [standard(999, 500), { ...express, amountMinor: 3100 }]);
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValueOnce({
      ok: false,
      error: { code: 'SHIPPING_CHANGED', message: 'The shipping profile changed.' },
    } as never);

    await act(async () => {
      await result.current.submit();
    });

    expect(sent(0)?.shippingChoices?.[0]).toMatchObject({ rateId: 'exp', profileSha256: SHA_A });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: SHIPPING_CHANGED_MESSAGE }));
    await waitFor(() => expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(3100));
    expect(CommerceController.fetchShippingProfile).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.submit();
    });

    expect(sent(1)?.shippingChoices?.[0]).toMatchObject({ rateId: 'exp', profileSha256: SHA_B });
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cheapest rate when a re-read removes the rate the buyer picked', async () => {
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    act(() => result.current.zoneShipping.setRate(group(result)!.key, 'exp'));

    served.profile = snapshot(SHA_B, [standard(999, 500)]);
    act(() => result.current.zoneShipping.refresh());
    await waitFor(() => expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(999 + 500));

    expect(group(result)?.state).toMatchObject({ status: 'ready', selectedRateId: 'std' });
  });

  it('sends nothing while the profile cannot be read', async () => {
    served.failing = true;
    const { result } = mount(profileItem(), 'DE');
    await waitFor(() => expect(group(result)?.state.status).toBe('unreadable'));

    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('could not be read') }),
    );
  });

  it('sends nothing to a country no zone serves', async () => {
    const { result } = mount(profileItem(), 'IT');
    await waitFor(() => expect(group(result)?.state.status).toBe('refused'));

    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('does not ship to that country') }),
    );
  });

  it('prices a listing’s own zones without reading any profile', async () => {
    const zones = [{ zoneId: 'eu', name: 'Europe', countries: ['DE'], rates: [standard(700, 100)] }];
    const { result } = mount(cartItem({ shippingZones: zones }, 3), 'DE');

    await waitFor(() => expect(group(result)?.state.status).toBe('ready'));
    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.fetchShippingProfile).not.toHaveBeenCalled();
    expect(result.current.zoneShipping.amounts[0]?.amountMinor).toBe(700 + 2 * 100);
    expect(sent()?.shippingChoices).toEqual([
      expect.objectContaining({
        listingAggregateId: `listing:${listing.ownerPubky}_${listing.listingId}`,
        rateId: 'std',
      }),
    ]);
    expect(sent()?.shippingChoices?.[0]).not.toHaveProperty('profileSha256');
  });

  it('adds nothing for a flat-priced listing: no destination, no choices, no profile read', async () => {
    const { result } = mount(cartItem({}, 1), 'DE');

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.zoneShipping.hasZonedGroups).toBe(false);
    expect(CommerceController.fetchShippingProfile).not.toHaveBeenCalled();
    expect(sent()).not.toHaveProperty('destinationCountry');
    expect(sent()).not.toHaveProperty('shippingChoices');
  });
});
