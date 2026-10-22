import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceCartItem } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { commerceListingShippingMinor } from '@/libs/commerce/marketplace-records';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { resetRegionState, setRegionModes } from '@/test-utils/region-modes';
import { useMarketplaceCheckout } from './useMarketplaceCheckout';

const listing = createCommerceSandboxCatalog().listings.find(({ sale }) => sale.format === 'fixed_price')!;
const price = listing.sale.format === 'fixed_price' ? listing.sale.unitPrice : listing.sale.startingPrice;
const shipping = { ...price, amountMinor: commerceListingShippingMinor(listing.shippingOptions) };
const item: MarketplaceCartItem = {
  id: 'cart-item',
  listingId: `${listing.ownerPubky}:${listing.listingId}`,
  variantId: listing.variants[0].id,
  quantity: 1,
  listing: {
    id: `${listing.ownerPubky}:${listing.listingId}`,
    seller_id: listing.ownerPubky,
    listing_id: listing.listingId,
    record: { ...listing, fulfillmentMethods: ['physical' as const] },
    revision: 1,
    state: 'active',
    category_id: listing.categoryId,
    format: listing.sale.format,
    currency: price.currency,
    price_minor: price.amountMinor,
    sync_status: 'synced',
    updated_at: Date.parse(listing.updatedAt),
  },
};

const config = vi.hoisted(() => ({
  mode: 'sandbox' as string,
  paykitServerApi: 'fork' as 'fork' | 'upstream',
}));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => config.mode,
    getPaykitServerApi: () => config.paykitServerApi,
  };
});

const shopState = vi.hoisted(() => ({ shipsTo: new Map<string, string[]>(), unreadable: new Set<string>() }));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    refreshShop: vi.fn(async (sellerPubky: string) => {
      if (shopState.unreadable.has(sellerPubky)) throw new Error('offline');
      return { ownerPubky: sellerPubky, shipsToCountries: shopState.shipsTo.get(sellerPubky) };
    }),
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

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn() },
}));

const authMock = vi.hoisted(() => ({ currentUserPubky: null as string | null }));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: authMock.currentUserPubky }),
}));

const SELLER_KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32).fill(7) };

describe('useMarketplaceCheckout buyer country under the region modes', () => {
  afterEach(() => resetRegionState());

  beforeEach(() => {
    vi.clearAllMocks();
    resetRegionState();
    shopState.shipsTo.clear();
    shopState.unreadable.clear();
    config.mode = 'sandbox';
    config.paykitServerApi = 'fork';
    authMock.currentUserPubky = null;
    useCommerceStore.setState({ marketplaceSession: null });
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([]);
    vi.mocked(CommerceController.commitUpsertDeliveryAddress).mockResolvedValue(undefined);
    vi.mocked(CommerceController.commitMarkDeliveryAddressUsed).mockResolvedValue(undefined);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000001100');
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
      aggregateId: `listing:${listing.ownerPubky}_${listing.listingId}`,
      sellerPubky: listing.ownerPubky,
      listingId: listing.listingId,
      listingRevision: listing.revision,
      contentHash: listing.media[0].contentHash,
      serverRevision: 1,
      state: 'available',
      availableQuantity: 1,
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
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000001100',
      aggregateId: 'checkout:00000000-0000-4000-8000-000000001100',
      revision: 1,
      eventIds: ['00000000-0000-4000-8000-000000001101'],
      result: { kind: 'checkout' },
    });
  });

  async function placeOrderTo(countryCode: string) {
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [item],
        vi.fn(async () => {}),
      ),
    );
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
      result.current.form.setValue('countryCode', countryCode);
    });
    await act(async () => {
      await result.current.submit();
    });
    return vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0]?.[0];
  }

  it('sends the address country and remembers nothing while regions are only blocked', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');

    const input = await placeOrderTo('us');

    expect(CommerceController.setBuyerCountry).not.toHaveBeenCalled();
    expect(input).toMatchObject({ buyerCountry: 'US' });
  });

  it('remembers the address country and lets the controller send it while a region is nuanced', async () => {
    setRegionModes('EU=nuanced,GB=nuanced,US=blocked');

    const input = await placeOrderTo('us');

    expect(CommerceController.setBuyerCountry).toHaveBeenCalledWith('US');
    expect(input).not.toHaveProperty('buyerCountry');
  });

  it('sends and remembers nothing while every region is open', async () => {
    setRegionModes('none');

    const input = await placeOrderTo('us');

    expect(CommerceController.setBuyerCountry).not.toHaveBeenCalled();
    expect(input).not.toHaveProperty('buyerCountry');
  });
});
