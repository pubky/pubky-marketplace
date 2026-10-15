import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceCartItem } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { commerceListingShippingMinor } from '@/libs/commerce/marketplace-records';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import { SHIPS_TO_UNAVAILABLE_MESSAGE } from '@/libs/commerce/ships-to';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { asOpaque } from '@/test-utils/type-assertions';
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
    rememberUsdtRefusal: vi.fn(),
    getMarketplaceOrders: vi.fn(async () => []),
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

const BUYER = 'b'.repeat(52);
const SELLER_KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32).fill(7) };

const savedAddress = {
  id: `${BUYER}:addr1`,
  owner_id: BUYER,
  label: 'Home',
  name: 'Alice Buyer',
  line1: '1 Market Street',
  line2: '',
  city: 'New York',
  region: 'NY',
  postal_code: '10001',
  country_code: 'US',
  is_default: true,
  last_used_at: null,
  created_at: 100,
  updated_at: 100,
};

describe('useMarketplaceCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('does not create a checkout when a shipped seller has no delivery key', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: false,
      sellerPubky: listing.ownerPubky,
      problem: { kind: 'no_key' },
    });
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
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(result.current.deliveryKeyBlock).toEqual({
      kind: 'no_key',
      sellerPubky: listing.ownerPubky,
      message: DELIVERY_KEY_COPY.noKey,
    });
  });

  it('refreshes terms and creates a guarantee-versioned checkout', async () => {
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentChoiceBySeller: { [listing.ownerPubky]: 'shipping' },
        deliveryAddress: expect.objectContaining({ line1: '1 Market Street' }),
        deliveryKeys: new Map([[listing.ownerPubky, SELLER_KEY]]),
        lines: [
          {
            listingAggregateId: `listing:${listing.ownerPubky}_${listing.listingId}`,
            sellerPubky: listing.ownerPubky,
            publishedFulfillmentMethods: ['shipping'],
            expectedRevision: 1,
            quantity: 1,
            // The chosen variant rides the line as a display snapshot: the
            // id plus its option dimensions as an ordered {name, value}
            // array (safe through the wire-casing layer).
            variantId: listing.variants[0].id,
            ...(Object.keys(listing.variants[0].options).length
              ? {
                  variantOptions: Object.entries(listing.variants[0].options).map(([name, value]) => ({
                    name,
                    value,
                  })),
                }
              : {}),
          },
        ],
      }),
    );
    expect(clear).toHaveBeenCalled();
  });

  it('heals an unregistered cart line with one sync before checking out', async () => {
    config.mode = 'transaction-service';
    const registered = {
      aggregateId: `listing:${listing.ownerPubky}_${listing.listingId}`,
      sellerPubky: listing.ownerPubky,
      listingId: listing.listingId,
      listingRevision: listing.revision,
      contentHash: listing.media[0].contentHash,
      serverRevision: 1,
      state: 'available' as const,
      availableQuantity: 1,
      reservedQuantity: 0,
      unitPrice: price,
      shipping,
      saleFormat: 'fixed_price' as const,
      fulfillmentMethods: ['shipping' as const],
      auction: null,
    };
    vi.mocked(CommerceController.getMarketplaceListingProjection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(registered as never);
    vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 1 } as never);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledTimes(1);
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ listingAggregateId: registered.aggregateId, expectedRevision: 1 })],
      }),
    );
  });

  it('fails honestly when the line sync also cannot register the listing', async () => {
    config.mode = 'transaction-service';
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(null);
    vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: "The seller's homeserver has no such listing record." },
    } as never);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledTimes(1);
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('could not be prepared for checkout') }),
    );
  });

  it('says the listing was removed when the line sync reports the seller deleted it', async () => {
    config.mode = 'transaction-service';
    const aggregateId = `listing:${listing.ownerPubky}_${listing.listingId}`;
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(null);
    vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000751',
      aggregateId,
      revision: 2,
      eventIds: [],
      result: { kind: 'listing_deleted', listing: { aggregateId, serverRevision: 2 } },
    } as never);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledTimes(1);
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'This listing was removed. Nothing was reserved.' }),
    );
  });

  describe('a registered line whose projection lags its record', () => {
    const aggregateId = `listing:${listing.ownerPubky}_${listing.listingId}`;
    const projection = {
      aggregateId,
      sellerPubky: listing.ownerPubky,
      listingId: listing.listingId,
      listingRevision: listing.revision,
      contentHash: listing.media[0].contentHash,
      serverRevision: 4,
      state: 'available' as const,
      availableQuantity: 1,
      reservedQuantity: 0,
      unitPrice: price,
      shipping,
      saleFormat: 'fixed_price' as const,
      fulfillmentMethods: ['shipping' as const],
      auction: null,
    };
    const fillAddress = (form: ReturnType<typeof useMarketplaceCheckout>['form']) => {
      form.setValue('name', 'Alice Buyer');
      form.setValue('line1', '1 Market Street');
      form.setValue('city', 'New York');
      form.setValue('region', 'NY');
      form.setValue('postalCode', '10001');
    };
    const pay = async (cartItem: MarketplaceCartItem) => {
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [cartItem],
          vi.fn(async () => {}),
        ),
      );
      act(() => fillAddress(result.current.form));
      let succeeded = false;
      await act(async () => {
        succeeded = await result.current.submit();
      });
      return succeeded;
    };

    beforeEach(() => {
      config.mode = 'transaction-service';
    });

    it('does not sync a line whose projection matches its record', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(projection);

      await expect(pay(item)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).not.toHaveBeenCalled();
    });

    it('syncs a line whose record revision moved past the projection and checks out at the healed revision', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection)
        .mockResolvedValueOnce(projection)
        .mockResolvedValueOnce({ ...projection, listingRevision: listing.revision + 1, serverRevision: 5 });
      vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 5 } as never);
      const edited: MarketplaceCartItem = {
        ...item,
        listing: { ...item.listing, record: { ...item.listing.record, revision: listing.revision + 1 } },
      };

      await expect(pay(edited)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
      expect(CommerceController.syncListingRegistration).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ lines: [expect.objectContaining({ expectedRevision: 5 })] }),
      );
    });

    it('syncs a line whose projected fulfillment differs from the record at the same revision', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection)
        .mockResolvedValueOnce({ ...projection, fulfillmentMethods: ['pickup'] })
        .mockResolvedValueOnce({ ...projection, serverRevision: 5 });
      vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 5 } as never);

      await expect(pay(item)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ lines: [expect.objectContaining({ expectedRevision: 5 })] }),
      );
    });

    it('checks out against the projection it has when the heal sync fails, leaving the verdict to the service', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
        ...projection,
        fulfillmentMethods: ['pickup'],
      });
      vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({
        ok: false,
        error: { code: 'UPSTREAM_UNAVAILABLE', message: "The seller's homeserver could not be reached." },
      } as never);

      await expect(pay(item)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ lines: [expect.objectContaining({ expectedRevision: 4 })] }),
      );
      const { Logger } = await import('@/libs/logger/logger');
      expect(vi.mocked(Logger.warn)).toHaveBeenCalledWith('Checkout line listing sync was refused', {
        code: 'UPSTREAM_UNAVAILABLE',
      });
    });

    it('syncs a line whose projected shipping differs from the record before checking out', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection)
        .mockResolvedValueOnce({ ...projection, shipping: { ...shipping, amountMinor: shipping.amountMinor + 500 } })
        .mockResolvedValueOnce({ ...projection, serverRevision: 5 });
      vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 5 } as never);

      await expect(pay(item)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ lines: [expect.objectContaining({ expectedRevision: 5 })] }),
      );
    });

    it.each([
      ['a newer record revision', { listingRevision: listing.revision + 1 }],
      ['a different unit price', { unitPrice: { ...price, amountMinor: price.amountMinor + 100 } }],
    ])('stops before ordering when the healed projection carries %s than the buyer saw', async (_label, edit) => {
      vi.mocked(CommerceController.getMarketplaceListingProjection)
        .mockResolvedValueOnce({ ...projection, fulfillmentMethods: ['pickup'] })
        .mockResolvedValueOnce({ ...projection, ...edit, serverRevision: 5 });
      vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 5 } as never);

      await expect(pay(item)).resolves.toBe(false);

      expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'A listing changed while you were checking out. Review your cart and try again.',
        }),
      );
      expect(CommerceController.refreshListing).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
    });

    it.each([
      ['a higher unit price', { unitPrice: { ...price, amountMinor: price.amountMinor + 100 } }],
      ['different shipping', { shipping: { ...shipping, amountMinor: shipping.amountMinor + 500 } }],
      ['different fulfillment methods', { fulfillmentMethods: ['pickup' as const] }],
      ['only a newer revision', {}],
    ])(
      'stops before ordering, without a sync, when the projection is of a newer record with %s',
      async (_label, edit) => {
        vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
          ...projection,
          ...edit,
          listingRevision: listing.revision + 1,
        });

        await expect(pay(item)).resolves.toBe(false);

        expect(CommerceController.syncListingRegistration).not.toHaveBeenCalled();
        expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
        expect(vi.mocked(toast)).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'A listing changed while you were checking out. Review your cart and try again.',
          }),
        );
        expect(CommerceController.refreshListing).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
      },
    );

    it.each([
      ['amount', 'the sync cannot heal it', { amountMinor: price.amountMinor + 100 }, { ok: true, revision: 5 }],
      [
        'amount',
        'the sync fails',
        { amountMinor: price.amountMinor + 100 },
        { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'unreachable' } },
      ],
      [
        'currency',
        'the sync cannot heal it',
        { currency: price.currency === 'EUR' ? 'USD' : 'EUR' },
        { ok: true, revision: 5 },
      ],
      ['exponent', 'the sync cannot heal it', { exponent: price.exponent + 1 }, { ok: true, revision: 5 }],
    ])(
      'stops before ordering when the unit price %s differs at the same revision and %s',
      async (_field, _label, drift, answer) => {
        const divergent = { ...projection, unitPrice: { ...price, ...drift } };
        vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(divergent);
        vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue(answer as never);

        await expect(pay(item)).resolves.toBe(false);

        expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
        expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
        expect(vi.mocked(toast)).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'A listing changed while you were checking out. Review your cart and try again.',
          }),
        );
        expect(CommerceController.refreshListing).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
      },
    );

    it('checks an auction line out against a newer projection, since it is paid at its bid', async () => {
      const auctionListing = createCommerceSandboxCatalog().listings.find(({ sale }) => sale.format === 'auction')!;
      const auctionItem: MarketplaceCartItem = {
        ...item,
        id: 'auction-item',
        listingId: `${auctionListing.ownerPubky}:${auctionListing.listingId}`,
        variantId: auctionListing.variants[0].id,
        listing: {
          ...item.listing,
          id: `${auctionListing.ownerPubky}:${auctionListing.listingId}`,
          listing_id: auctionListing.listingId,
          record: auctionListing,
          format: 'auction',
        },
      };
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
        ...projection,
        aggregateId: `listing:${auctionListing.ownerPubky}_${auctionListing.listingId}`,
        listingId: auctionListing.listingId,
        listingRevision: auctionListing.revision + 1,
        unitPrice: { ...price, amountMinor: price.amountMinor + 100 },
        saleFormat: 'auction',
      });

      await expect(pay(auctionItem)).resolves.toBe(true);

      expect(CommerceController.syncListingRegistration).not.toHaveBeenCalled();
      expect(CommerceController.refreshListing).not.toHaveBeenCalled();
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledOnce();
    });

    it('still stops, and logs, when the changed listing cannot be refreshed', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
        ...projection,
        listingRevision: listing.revision + 1,
      });
      vi.mocked(CommerceController.refreshListing).mockRejectedValueOnce(new TypeError('offline'));

      await expect(pay(item)).resolves.toBe(false);

      expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
      const { Logger } = await import('@/libs/logger/logger');
      expect(vi.mocked(Logger.warn)).toHaveBeenCalledWith('Checkout could not refresh a changed listing', {
        error: expect.any(TypeError),
      });
    });
  });

  it('keeps the cart and asks for a retry when a listing revision conflicts mid-checkout', async () => {
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: false,
      error: { code: 'REVISION_CONFLICT', message: 'The aggregate changed.', currentRevision: 2 },
    });
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('try again') }),
    );
  });

  it.each([
    [
      {
        code: 'LISTING_NOT_ACTIVE',
        message: 'The seller is not selling this listing right now.',
        reason: 'listing_paused',
      },
      'The seller paused this listing. Check back later.',
    ],
    [
      { code: 'UPSTREAM_UNAVAILABLE', message: "The seller's homeserver could not be reached. Try again shortly." },
      "We couldn't reach the seller's shop. Try again in a moment.",
    ],
  ])('keeps the cart and shows static copy for a %o checkout refusal', async (error, expected) => {
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({ ok: false, error } as never);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ description: expected }));
  });

  it('shows listing-specific copy and returns false for a sold-out checkout refusal', async () => {
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_STATE', message: 'This listing has sold out.' },
    } as never);
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
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'This listing has sold out.' }),
    );
  });

  it('shows own-listing copy without setting needsSession', async () => {
    authMock.currentUserPubky = listing.ownerPubky;
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'A buyer cannot purchase their own listing.' },
    } as never);
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
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });

    expect(result.current.needsSession).toBe(false);
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'You cannot purchase your own listing.' }),
    );
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('session expired');
  });

  it('uses generic checkout copy for an unmapped refusal code', async () => {
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN_REFUSAL', message: 'Unmapped refusal' },
    } as never);
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
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });

    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Checkout could not be completed.' }),
    );
  });

  it('reports success when cart clearing fails after the order is placed', async () => {
    const clear = vi.fn().mockRejectedValue(new Error('cart failure'));
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(true);
    });

    const { toast } = await import('@/molecules/Toaster/use-toast');
    const descriptions = vi.mocked(toast).mock.calls.map(([call]) => call.description);
    expect(descriptions).toContain('Checkout completed, but your cart could not be cleared.');
  });

  it('reports success when the post-order address save fails', async () => {
    authMock.currentUserPubky = BUYER;
    vi.mocked(CommerceController.commitUpsertDeliveryAddress).mockRejectedValue(new Error('address failure'));
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
      result.current.form.setValue('saveAddress', true);
      result.current.form.setValue('saveLabel', 'Home');
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(true);
    });

    const { toast } = await import('@/molecules/Toaster/use-toast');
    const descriptions = vi.mocked(toast).mock.calls.map(([call]) => call.description);
    expect(descriptions).toContain('Checkout completed, but the address could not be saved.');
  });

  it('starts a new address in the browser country, and a saved address replaces it', async () => {
    authMock.currentUserPubky = BUYER;
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de']);
    try {
      const fresh = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(fresh.result.current.form.getValues('countryCode')).toBe('DE'));
      expect(fresh.result.current.form.getFieldState('countryCode').isDirty).toBe(false);
      fresh.unmount();

      vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([savedAddress]);
      const saved = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(saved.result.current.selectedAddressId).toBe(savedAddress.id));
      expect(saved.result.current.form.getValues('countryCode')).toBe('US');
    } finally {
      languages.mockRestore();
    }
  });

  it('prefills from the top saved address and marks it used after a successful order', async () => {
    authMock.currentUserPubky = BUYER;
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([savedAddress]);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));

    await vi.waitFor(() => {
      if (result.current.selectedAddressId !== savedAddress.id) throw new Error('Address has not been applied yet.');
    });
    expect(result.current.addresses).toEqual([savedAddress]);
    expect(result.current.form.getValues('line1')).toBe('1 Market Street');
    expect(result.current.form.getValues()).not.toHaveProperty('acceptsGuarantee');

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryAddress: {
          name: 'Alice Buyer',
          line1: '1 Market Street',
          line2: '',
          city: 'New York',
          region: 'NY',
          postalCode: '10001',
          countryCode: 'US',
        },
      }),
    );
    expect(CommerceController.commitMarkDeliveryAddressUsed).toHaveBeenCalledWith('addr1');
    expect(CommerceController.commitUpsertDeliveryAddress).not.toHaveBeenCalled();
  });

  it('saves a new labeled address after ordering when the buyer opted in', async () => {
    authMock.currentUserPubky = BUYER;
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
      result.current.form.setValue('saveAddress', true);
      result.current.form.setValue('saveLabel', 'Home');
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(CommerceController.commitUpsertDeliveryAddress).toHaveBeenCalledWith(expect.any(String), {
      label: 'Home',
      name: 'Alice Buyer',
      line1: '1 Market Street',
      line2: '',
      city: 'New York',
      region: 'NY',
      postalCode: '10001',
      countryCode: 'US',
    });
    expect(CommerceController.commitMarkDeliveryAddressUsed).toHaveBeenCalled();
  });

  it('drops the picker selection when the buyer edits a picked address', async () => {
    authMock.currentUserPubky = BUYER;
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([savedAddress]);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [item],
        vi.fn(async () => {}),
      ),
    );
    await vi.waitFor(() => {
      if (result.current.selectedAddressId !== savedAddress.id) throw new Error('Address has not been applied yet.');
    });

    act(() => {
      result.current.form.setValue('line1', '99 Elsewhere Avenue');
    });

    await vi.waitFor(() => {
      if (result.current.selectedAddressId !== null) throw new Error('Selection has not been dropped yet.');
    });

    // Re-picking restores the saved values.
    act(() => {
      result.current.selectAddress(savedAddress.id);
    });
    expect(result.current.form.getValues('line1')).toBe('1 Market Street');
    expect(result.current.selectedAddressId).toBe(savedAddress.id);
  });

  it('reports hasMarketplaceSession only when the store and getActiveSession agree', () => {
    vi.mocked(CommerceController.hasActiveMarketplaceSession).mockReturnValue(true);
    useCommerceStore.setState({
      marketplaceSession: {
        pubky: BUYER,
        capabilities: '',
        expiresAt: '2099-01-01T00:00:00.000Z',
        issuedAt: '2026-08-21T00:00:00.000Z',
      },
    });
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [item],
        vi.fn(async () => {}),
      ),
    );

    expect(result.current.hasMarketplaceSession).toBe(true);

    vi.mocked(CommerceController.hasActiveMarketplaceSession).mockReturnValue(false);
    const expired = renderHook(() =>
      useMarketplaceCheckout(
        [item],
        vi.fn(async () => {}),
      ),
    );
    expect(expired.result.current.hasMarketplaceSession).toBe(false);
  });

  it('clears only the identity session when checkout TTL expires', () => {
    vi.mocked(CommerceController.hasActiveMarketplaceSession).mockReturnValue(false);
    useCommerceStore.setState({
      marketplaceSession: {
        pubky: BUYER,
        capabilities: '',
        expiresAt: '2099-01-01T00:00:00.000Z',
        issuedAt: '2026-08-21T00:00:00.000Z',
      },
      inventorySession: {
        pubky: BUYER,
        capabilities: '/pub/pubky.app/marketplace-service/v1/:rw',
        expiresAt: '2099-01-01T00:00:00.000Z',
        issuedAt: '2026-08-21T00:00:00.000Z',
      },
    });
    renderHook(() =>
      useMarketplaceCheckout(
        [item],
        vi.fn(async () => {}),
      ),
    );
    expect(CommerceController.clearIdentitySession).toHaveBeenCalled();
    expect(CommerceController.clearMarketplaceSession).not.toHaveBeenCalled();
  });

  it('pays by creating then binding, and cancels leftovers when bind fails', async () => {
    config.mode = 'locks-paykit';
    const orderId = '018f47d2-6a27-7c23-a49d-000000001200';
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000001100',
      aggregateId: 'checkout:00000000-0000-4000-8000-000000001100',
      revision: 1,
      eventIds: [],
      result: { kind: 'checkout', orders: [{ id: orderId }] },
    });
    vi.mocked(CommerceController.bindPaymentMethod).mockResolvedValue({
      id: orderId,
      state: 'pending_payment',
      paymentMethod: 'bitcoin',
    } as never);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let paid: Awaited<ReturnType<typeof result.current.pay>> | null = null;
    await act(async () => {
      paid = await result.current.pay('bitcoin');
    });

    expect(paid).toEqual({
      ok: true,
      orderIds: [orderId],
      boundOrders: [expect.objectContaining({ id: orderId, paymentMethod: 'bitcoin' })],
    });
    expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(orderId, 'bitcoin');
    expect(clear).toHaveBeenCalled();

    vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(new Error('bind failed'));
    const paidAfterFail = await act(async () => result.current.pay('bitcoin'));
    expect(paidAfterFail.ok).toBe(false);
    expect(CommerceController.executeMarketplaceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'order.cancel_request',
        payload: expect.objectContaining({ orderId }),
      }),
    );

    // A refused bind because Paykit is down is reported on the result so the page can retry on its own.
    vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
        message: 'SENTINEL',
        service: ErrorService.Marketplace,
        operation: 'bindPaymentMethod',
        context: { statusCode: 503, reason: 'paykit_unavailable' },
      }),
    );
    const paykitDown = await act(async () => result.current.pay('bitcoin'));
    expect(paykitDown).toMatchObject({ ok: false, paykitUnavailable: true });
    expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toMatchObject({
      variant: 'error',
      description: 'Paykit is temporarily unreachable, retrying…',
    });
    expect(paidAfterFail.paykitUnavailable).toBeUndefined();

    // service#84: an unfinished Paykit wallet refuses the bind. The toast names it and offers
    // Try again, which runs only the caller's step on click; the hook never retries by itself.
    const onRetry = vi.fn();
    const bindsBefore = vi.mocked(CommerceController.bindPaymentMethod).mock.calls.length;
    vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
        message: 'SENTINEL',
        service: ErrorService.Marketplace,
        operation: 'bindPaymentMethod',
        context: { statusCode: 409, reason: 'buyer_paykit_wallet_setup_needed', serviceCode: 'INVALID_STATE' },
      }),
    );
    const setupNeeded = await act(async () => result.current.pay('bitcoin', onRetry));
    expect(setupNeeded.ok).toBe(false);
    const setupToast = vi.mocked(toast).mock.calls.at(-1)?.[0];
    expect(setupToast).toMatchObject({
      variant: 'error',
      title: 'Reader wallet setup needed',
      description: 'Finish setting up Bitkit (or another Paykit wallet) for this pubky, then try again.',
    });
    expect(vi.mocked(CommerceController.bindPaymentMethod).mock.calls.length).toBe(bindsBefore + 1);
    expect(onRetry).not.toHaveBeenCalled();
    asOpaque<{ props: { onClick: () => void } }>(setupToast?.action).props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(CommerceController.bindPaymentMethod).mock.calls.length).toBe(bindsBefore + 1);
  });

  describe('after a refused USDT bind', () => {
    const orderId = '018f47d2-6a27-7c23-a49d-000000001210';

    const usdtBindRefusal = (reason: string) =>
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
        message: 'SENTINEL',
        service: ErrorService.Marketplace,
        operation: 'bindPaymentMethod',
        context: { statusCode: 409, reason, paymentMethod: 'usdt' },
      });

    async function payRefused(method: 'usdt' | 'bitcoin', error: unknown) {
      config.mode = 'locks-paykit';
      vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
        ok: true,
        version: 1,
        commandId: '00000000-0000-4000-8000-000000001110',
        aggregateId: 'checkout:00000000-0000-4000-8000-000000001110',
        revision: 1,
        eventIds: [],
        result: { kind: 'checkout', orders: [{ id: orderId }] },
      });
      vi.mocked(CommerceController.bindPaymentMethod).mockRejectedValueOnce(error);
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
      });
      return await act(async () => result.current.pay(method));
    }

    it.each(['usdt_unavailable', 'usdt_seller_not_ready'] as const)(
      'remembers %s for this seller and still cancels the order and shows the refusal once',
      async (reason) => {
        vi.mocked(CommerceController.rememberUsdtRefusal).mockClear();
        vi.mocked(toast).mockClear();

        const paid = await payRefused('usdt', usdtBindRefusal(reason));

        expect(paid.ok).toBe(false);
        expect(CommerceController.rememberUsdtRefusal).toHaveBeenCalledTimes(1);
        expect(CommerceController.rememberUsdtRefusal).toHaveBeenCalledWith(item.listing.record.ownerPubky, reason);
        expect(CommerceController.executeMarketplaceCommand).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'order.cancel_request', payload: expect.objectContaining({ orderId }) }),
        );
        expect(vi.mocked(toast)).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['buyer_usdt_wallet_required', 'paykit_rejected'])(
      'does not remember %s, which another try or the buyer can fix',
      async (reason) => {
        vi.mocked(CommerceController.rememberUsdtRefusal).mockClear();

        await payRefused('usdt', usdtBindRefusal(reason));

        expect(CommerceController.rememberUsdtRefusal).not.toHaveBeenCalled();
      },
    );

    it('does not remember a refusal of another rail', async () => {
      vi.mocked(CommerceController.rememberUsdtRefusal).mockClear();

      await payRefused('bitcoin', new Error('bind failed'));

      expect(CommerceController.rememberUsdtRefusal).not.toHaveBeenCalled();
    });
  });

  it.each([null, 'bitcoin', 'paypal'] as const)('skips durable binding in sandbox with method %s', async (method) => {
    const orderId = '018f47d2-6a27-7c23-a49d-000000001201';
    config.mode = 'sandbox';
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000001100',
      aggregateId: 'checkout:00000000-0000-4000-8000-000000001100',
      revision: 1,
      eventIds: [],
      result: { kind: 'checkout', orders: [{ id: orderId }] },
    });
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let paid: Awaited<ReturnType<typeof result.current.pay>> | null = null;
    await act(async () => {
      paid = await result.current.pay(method);
    });

    expect(paid).toEqual({ ok: true, orderIds: [orderId], boundOrders: [] });
    expect(CommerceController.bindPaymentMethod).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  describe('seller destination countries (shop shipsToCountries)', () => {
    const SWISS_ONLY = 'This seller ships only to Switzerland. Choose pickup if offered.';

    function fillAddress(
      result: { current: ReturnType<typeof useMarketplaceCheckout> },
      address: { line1: string; city: string; postalCode: string; countryCode: string },
    ) {
      act(() => {
        result.current.form.setValue('name', 'Alice Buyer');
        result.current.form.setValue('line1', address.line1);
        result.current.form.setValue('city', address.city);
        result.current.form.setValue('region', '');
        result.current.form.setValue('postalCode', address.postalCode);
        result.current.form.setValue('countryCode', address.countryCode, { shouldDirty: true });
      });
    }

    it('offers only the seller’s countries and starts a new address in the only one', async () => {
      shopState.shipsTo.set(listing.ownerPubky, ['CH']);
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );

      await waitFor(() => expect(result.current.allowedDestinationCountries).toEqual(['CH']));
      expect(result.current.form.getValues('countryCode')).toBe('CH');
      expect(CommerceController.refreshShop).toHaveBeenCalledWith(listing.ownerPubky);
    });

    it('checks out an address in an allowed country', async () => {
      shopState.shipsTo.set(listing.ownerPubky, ['CH', 'LI']);
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(result.current.allowedDestinationCountries).toEqual(['CH', 'LI']));
      fillAddress(result, { line1: 'Via Nassa 1', city: 'Lugano', postalCode: '6900', countryCode: 'CH' });

      let succeeded = false;
      await act(async () => {
        succeeded = await result.current.submit();
      });

      expect(succeeded).toBe(true);
      expect(CommerceController.commitCreateMarketplaceCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryAddress: expect.objectContaining({ countryCode: 'CH', city: 'Lugano' }) }),
      );
    });

    it('marks a disallowed country invalid and never resolves keys or seals', async () => {
      shopState.shipsTo.set(listing.ownerPubky, ['CH']);
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(result.current.allowedDestinationCountries).toEqual(['CH']));
      fillAddress(result, { line1: 'Unter den Linden 1', city: 'Berlin', postalCode: '10117', countryCode: 'DE' });

      let succeeded = true;
      await act(async () => {
        succeeded = await result.current.submit();
      });

      expect(succeeded).toBe(false);
      expect(result.current.form.getFieldState('countryCode').error?.message).toBe(SWISS_ONLY);
      expect(CommerceController.resolveDeliveryKeysForCheckout).not.toHaveBeenCalled();
      expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    });

    it('re-reads the shop before sealing and refuses a country the seller removed since the page loaded', async () => {
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(CommerceController.refreshShop).toHaveBeenCalled());
      expect(result.current.allowedDestinationCountries).toBeNull();
      shopState.shipsTo.set(listing.ownerPubky, ['CH']);
      fillAddress(result, { line1: 'Unter den Linden 1', city: 'Berlin', postalCode: '10117', countryCode: 'DE' });

      let succeeded = true;
      await act(async () => {
        succeeded = await result.current.submit();
      });

      expect(succeeded).toBe(false);
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: SWISS_ONLY });
      expect(CommerceController.resolveDeliveryKeysForCheckout).not.toHaveBeenCalled();
      expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    });

    it('refuses to ship when the seller’s shop cannot be read at all', async () => {
      shopState.unreadable.add(listing.ownerPubky);
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [item],
          vi.fn(async () => {}),
        ),
      );
      fillAddress(result, { line1: 'Via Nassa 1', city: 'Lugano', postalCode: '6900', countryCode: 'CH' });

      await waitFor(() =>
        expect(result.current.form.getFieldState('countryCode').error?.message).toBe(SHIPS_TO_UNAVAILABLE_MESSAGE),
      );
      let succeeded = true;
      await act(async () => {
        succeeded = await result.current.submit();
      });
      expect(succeeded).toBe(false);
      expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    });

    it('leaves pickup alone: a Swiss-only seller’s pickup order sends no address and is not checked', async () => {
      shopState.shipsTo.set(listing.ownerPubky, ['CH']);
      vi.mocked(CommerceController.getShippedSellers).mockReturnValue([]);
      const pickupItem: MarketplaceCartItem = {
        ...item,
        listing: { ...item.listing, record: { ...item.listing.record, fulfillmentMethods: ['pickup'] } },
      };
      const { result } = renderHook(() =>
        useMarketplaceCheckout(
          [pickupItem],
          vi.fn(async () => {}),
        ),
      );
      await waitFor(() => expect(result.current.requiresDeliveryAddress).toBe(false));

      let succeeded = false;
      await act(async () => {
        succeeded = await result.current.submit();
      });

      expect(succeeded).toBe(true);
      expect(result.current.allowedDestinationCountries).toBeNull();
      expect(CommerceController.refreshShop).not.toHaveBeenCalled();
      expect(vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0]).not.toHaveProperty(
        'deliveryAddress',
      );
    });
  });
});

describe('useMarketplaceCheckout Locks checkout on upstream Paykit', () => {
  const orderId = '018f47d2-6a27-7c23-a49d-000000001300';
  const lockedItem: MarketplaceCartItem = {
    ...item,
    id: 'locked-item',
    listing: {
      ...item.listing,
      record: {
        ...item.listing.record,
        fulfillmentMethods: ['digital'],
        shippingOptions: [],
        digitalLock: {
          policyUri: 'pubky://lock',
          criterionId: 'c',
          contentPath: 'p',
          resourceHash: 'h',
          minimumConfirmations: 1,
        },
      } as MarketplaceCartItem['listing']['record'],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'locks-paykit';
    config.paykitServerApi = 'upstream';
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([]);
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
      shipping: { ...price, amountMinor: 0 },
      saleFormat: 'fixed_price',
      fulfillmentMethods: ['digital'],
      auction: null,
    });
    vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 1 } as never);
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000001100',
      aggregateId: 'checkout:00000000-0000-4000-8000-000000001100',
      revision: 1,
      eventIds: [],
      result: { kind: 'checkout', orders: [{ id: orderId }] },
    });
  });

  const fillForm = (current: ReturnType<typeof useMarketplaceCheckout>) => {
    act(() => {
      current.form.setValue('name', 'Alice Buyer');
      current.form.setValue('line1', '1 Market Street');
      current.form.setValue('city', 'New York');
      current.form.setValue('region', 'NY');
      current.form.setValue('postalCode', '10001');
    });
  };

  it('creates the order and binds no method, leaving the payment to the order page', async () => {
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([lockedItem], clear));
    fillForm(result.current);

    const paid = await act(async () => result.current.pay(null));

    expect(paid).toEqual({ ok: true, orderIds: [orderId], boundOrders: [] });
    expect(CommerceController.bindPaymentMethod).not.toHaveBeenCalled();
    expect(CommerceController.executeMarketplaceCommand).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  it('still binds a Locks checkout on the fork Paykit Server', async () => {
    config.paykitServerApi = 'fork';
    vi.mocked(CommerceController.bindPaymentMethod).mockResolvedValue({ id: orderId } as never);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lockedItem],
        vi.fn(async () => {}),
      ),
    );
    fillForm(result.current);

    await act(async () => result.current.pay('bitcoin'));

    expect(CommerceController.bindPaymentMethod).toHaveBeenCalledWith(orderId, 'bitcoin');
  });

  it('checks a Locks line out as digital, with no address, whatever the deployment offers for digital delivery', async () => {
    vi.mocked(CommerceController.fetchDigitalDeliveryCapability).mockResolvedValue({
      available: false,
      maxBytes: null,
    });
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lockedItem],
        vi.fn(async () => {}),
      ),
    );

    expect(result.current.requiresDeliveryAddress).toBe(false);
    expect(result.current.fulfillmentForItem(lockedItem.id)).toBe('digital');
    expect(result.current.isDigitalReady).toBe(true);
    expect(result.current.digitalNotReadyItemIds).toEqual([]);
    expect(result.current.isDigitalCapabilityLoading).toBe(false);
    expect(CommerceController.fetchDigitalDeliveryCapability).not.toHaveBeenCalled();

    const paid = await act(async () => result.current.pay(null));

    expect(paid.ok).toBe(true);
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.lines.map((line) => line.fulfillmentChoice)).toEqual(['digital']);
    expect(command.lines[0].publishedFulfillmentMethods).toEqual(['digital']);
    expect(command).not.toHaveProperty('deliveryAddress');
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
    expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['refused', async () => ({ ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'unreachable' } })],
    [
      'unreachable',
      async () => {
        throw new TypeError('network down');
      },
    ],
  ])('refuses a Locks line whose sync is %s, with a retryable message and nothing ordered', async (_label, sync) => {
    vi.mocked(CommerceController.syncListingRegistration).mockImplementation(sync as never);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lockedItem],
        vi.fn(async () => {}),
      ),
    );

    const paid = await act(async () => result.current.pay(null));

    expect(paid.ok).toBe(false);
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'A Locks item in your cart could not be confirmed with the marketplace. Nothing was reserved. Try again in a moment.',
      }),
    );
    const { Logger } = await import('@/libs/logger/logger');
    expect(vi.mocked(Logger.warn)).toHaveBeenCalled();
  });

  it('syncs a Locks line before checkout, healing a projection registered as shipping-only', async () => {
    const current = await CommerceController.getMarketplaceListingProjection(listing.ownerPubky, listing.listingId);
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockClear();
    vi.mocked(CommerceController.getMarketplaceListingProjection)
      .mockResolvedValueOnce({ ...current!, fulfillmentMethods: ['shipping'] })
      .mockResolvedValueOnce({ ...current!, serverRevision: 2 });
    vi.mocked(CommerceController.syncListingRegistration).mockResolvedValue({ ok: true, revision: 2 } as never);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lockedItem],
        vi.fn(async () => {}),
      ),
    );

    const paid = await act(async () => result.current.pay(null));

    expect(paid.ok).toBe(true);
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledOnce();
    expect(CommerceController.syncListingRegistration).toHaveBeenCalledWith(listing.ownerPubky, listing.listingId);
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.lines[0]).toMatchObject({ fulfillmentChoice: 'digital', expectedRevision: 2 });
  });

  it('refuses a cart mixing Locks and other lines before creating any order', async () => {
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lockedItem, item],
        vi.fn(async () => {}),
      ),
    );
    fillForm(result.current);

    const paid = await act(async () => result.current.pay('bitcoin'));

    expect(paid.ok).toBe(false);
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(CommerceController.bindPaymentMethod).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });
});

describe('useMarketplaceCheckout local pickup (§A2)', () => {
  const OTHER_SELLER = 'z'.repeat(52);

  function itemWithFulfillment(
    methods: Array<'physical' | 'digital' | 'shipping' | 'pickup'>,
    sellerPubky = listing.ownerPubky,
  ): MarketplaceCartItem {
    return {
      ...item,
      id: `cart-item-${sellerPubky.slice(0, 4)}-${methods.join('-')}`,
      listing: {
        ...item.listing,
        id: `${sellerPubky}:${listing.listingId}`,
        seller_id: sellerPubky,
        record: { ...item.listing.record, ownerPubky: sellerPubky, fulfillmentMethods: methods },
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    shopState.shipsTo.clear();
    shopState.unreadable.clear();
    config.mode = 'sandbox';
    authMock.currentUserPubky = null;
    useCommerceStore.setState({ marketplaceSession: null });
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([]);
    vi.mocked(CommerceController.fetchPickupAvailable).mockResolvedValue(true);
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

  it('resolves an award from its accepted fulfillment methods alone', async () => {
    const pickupOnly = { sellerPubky: listing.ownerPubky, fulfillmentMethods: ['pickup' as const] };
    const { result, rerender } = renderHook(
      ({ award }) =>
        useMarketplaceCheckout(
          [],
          vi.fn(async () => {}),
          award,
        ),
      { initialProps: { award: pickupOnly } },
    );
    await waitFor(() => expect(result.current.requiresDeliveryAddress).toBe(false));
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['pickup']);
    expect(result.current.fulfillmentForSeller(listing.ownerPubky)).toBe('pickup');

    rerender({ award: { sellerPubky: listing.ownerPubky, fulfillmentMethods: ['shipping', 'pickup'] } as never });
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping', 'pickup']);
    expect(result.current.fulfillmentForSeller(listing.ownerPubky)).toBe('shipping');
    expect(result.current.requiresDeliveryAddress).toBe(true);
  });

  it('settles an award through its physical methods only, as one order', async () => {
    const award = { sellerPubky: listing.ownerPubky, fulfillmentMethods: ['shipping' as const, 'digital' as const] };
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [],
        vi.fn(async () => {}),
        award,
      ),
    );
    await waitFor(() => expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false));

    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping']);
    expect(result.current.requiresDeliveryAddress).toBe(true);
    expect(result.current.orderCount).toBe(1);
  });

  it('keeps a pickup-only award unpayable while the deployment has no pickup', async () => {
    vi.mocked(CommerceController.fetchPickupAvailable).mockResolvedValue(false);
    const award = { sellerPubky: listing.ownerPubky, fulfillmentMethods: ['pickup' as const] };
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [],
        vi.fn(async () => {}),
        award,
      ),
    );
    await waitFor(() => expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false));
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual([]);
    expect(result.current.hasFulfillmentConflict).toBe(true);
  });

  it('omits the delivery address from the checkout command on a pickup-only cart', async () => {
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([itemWithFulfillment(['pickup'])], clear));

    await waitFor(() => {
      expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false);
      expect(result.current.requiresDeliveryAddress).toBe(false);
    });
    expect(result.current.fulfillmentForSeller(listing.ownerPubky)).toBe('pickup');

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command).not.toHaveProperty('deliveryAddress');
    expect(command.fulfillmentChoiceBySeller).toEqual({ [listing.ownerPubky]: 'pickup' });
    expect(clear).toHaveBeenCalled();
  });

  it('sends the address on a mixed cart and keeps each group\u2019s fulfillment choice independent', async () => {
    const shippingItem = itemWithFulfillment(['physical'], OTHER_SELLER);
    const bothWaysItem = itemWithFulfillment(['physical', 'shipping', 'pickup']);
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([shippingItem, bothWaysItem], clear));

    await waitFor(() => expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false));

    // The buyer collects from the both-ways seller; the other seller ships.
    act(() => {
      result.current.setFulfillmentChoice(listing.ownerPubky, 'pickup');
    });
    expect(result.current.fulfillmentForSeller(listing.ownerPubky)).toBe('pickup');
    expect(result.current.fulfillmentForSeller(OTHER_SELLER)).toBe('shipping');
    expect(result.current.requiresDeliveryAddress).toBe(true);
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.deliveryAddress).toEqual(expect.objectContaining({ line1: '1 Market Street' }));
    expect(command.fulfillmentChoiceBySeller).toEqual({
      [listing.ownerPubky]: 'pickup',
      [OTHER_SELLER]: 'shipping',
    });
  });

  it('removes pickup from the options when the deployment capability is off', async () => {
    vi.mocked(CommerceController.fetchPickupAvailable).mockResolvedValue(false);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [itemWithFulfillment(['physical', 'shipping', 'pickup'])],
        vi.fn(async () => {}),
      ),
    );

    await vi.waitFor(() => {
      expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping']);
    });
    // A pickup-only listing on such a deployment leaves the group with no
    // common method — the honest conflict, never a silent shipping fallback.
    const conflict = renderHook(() =>
      useMarketplaceCheckout(
        [itemWithFulfillment(['pickup'])],
        vi.fn(async () => {}),
      ),
    );
    await vi.waitFor(() => {
      expect(conflict.result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual([]);
    });
    expect(conflict.result.current.hasFulfillmentConflict).toBe(true);
  });

  it('does not treat unknown pickup capability as eligible', async () => {
    let release: (value: boolean) => void = () => {};
    vi.mocked(CommerceController.fetchPickupAvailable).mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [itemWithFulfillment(['physical', 'shipping', 'pickup'])],
        vi.fn(async () => {}),
      ),
    );

    expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(true);
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping']);
    expect(result.current.fulfillmentForSeller(listing.ownerPubky)).toBe('shipping');

    await act(async () => {
      release(true);
    });
    await waitFor(() => {
      expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false);
    });
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping', 'pickup']);
  });

  it('never reports pickup capability as loading for a group whose lines only ship', async () => {
    let release: (value: boolean) => void = () => {};
    vi.mocked(CommerceController.fetchPickupAvailable).mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [itemWithFulfillment(['physical'], OTHER_SELLER), itemWithFulfillment(['physical', 'shipping', 'pickup'])],
        vi.fn(async () => {}),
      ),
    );

    expect(result.current.isPickupCapabilityLoadingForSeller(OTHER_SELLER)).toBe(false);
    expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(true);
    expect(result.current.fulfillmentOptionsForSeller(OTHER_SELLER)).toEqual(['shipping']);

    await act(async () => {
      release(false);
    });
    await waitFor(() => {
      expect(result.current.isPickupCapabilityLoadingForSeller(listing.ownerPubky)).toBe(false);
    });
    expect(result.current.isPickupCapabilityLoadingForSeller(OTHER_SELLER)).toBe(false);
  });

  it('maps server and thrown sentinel failures to static copy', async () => {
    const sentinel = 'SENTINEL_SERVER_TEXT_checkout';
    const { toast } = await import('@/molecules/Toaster/use-toast');
    const clear = vi.fn(async () => {});
    const { result } = renderHook(() => useMarketplaceCheckout([item], clear));
    act(() => {
      result.current.form.setValue('name', 'Alice Buyer');
      result.current.form.setValue('line1', '1 Market Street');
      result.current.form.setValue('city', 'New York');
      result.current.form.setValue('region', 'NY');
      result.current.form.setValue('postalCode', '10001');
    });

    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: sentinel },
    } as never);
    await act(async () => {
      await result.current.submit();
    });
    expect(vi.mocked(toast).mock.calls[0]?.[0]?.description).toBeTypeOf('string');
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(sentinel);

    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockRejectedValueOnce(
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.CONFLICT,
        message: sentinel,
        service: ErrorService.Marketplace,
        operation: 'checkout',
      }),
    );
    await act(async () => {
      await result.current.submit();
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(sentinel);
  });
});

describe('useMarketplaceCheckout digital delivery (digital delivery design §3 "Checkout", §6 B2–B5, F1)', () => {
  type Kind = 'file' | 'link' | 'text' | 'email' | 'message';
  const kinds: Record<string, Kind | null> = {};

  function digitalCartItem(
    listingId: string,
    methods: Array<'physical' | 'digital' | 'shipping' | 'pickup'>,
    sellerPubky = listing.ownerPubky,
  ): MarketplaceCartItem {
    return {
      ...item,
      id: `cart-${listingId}`,
      listingId: `${sellerPubky}:${listingId}`,
      listing: {
        ...item.listing,
        id: `${sellerPubky}:${listingId}`,
        seller_id: sellerPubky,
        listing_id: listingId,
        record: { ...item.listing.record, ownerPubky: sellerPubky, listingId, fulfillmentMethods: methods },
      },
    };
  }

  const fillAddress = (form: ReturnType<typeof useMarketplaceCheckout>['form']) => {
    form.setValue('name', 'Alice Buyer');
    form.setValue('line1', '1 Market Street');
    form.setValue('city', 'New York');
    form.setValue('region', 'NY');
    form.setValue('postalCode', '10001');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    shopState.shipsTo.clear();
    shopState.unreadable.clear();
    config.mode = 'sandbox';
    authMock.currentUserPubky = null;
    useCommerceStore.setState({ marketplaceSession: null });
    for (const key of Object.keys(kinds)) delete kinds[key];
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([]);
    vi.mocked(CommerceController.fetchPickupAvailable).mockResolvedValue(true);
    vi.mocked(CommerceController.fetchDigitalDeliveryCapability).mockResolvedValue({ available: true, maxBytes: null });
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockImplementation(
      async (sellerPubky: unknown, listingId: unknown) => ({
        aggregateId: `listing:${String(sellerPubky)}_${String(listingId)}`,
        sellerPubky: String(sellerPubky),
        listingId: String(listingId),
        listingRevision: listing.revision,
        contentHash: listing.media[0].contentHash,
        serverRevision: 1,
        state: 'available',
        availableQuantity: 1,
        reservedQuantity: 0,
        unitPrice: price,
        saleFormat: 'fixed_price',
        fulfillmentMethods: ['shipping'],
        auction: null,
        digitalDelivery:
          String(listingId) in kinds ? (kinds[String(listingId)] ? { kind: kinds[String(listingId)]! } : null) : null,
      }),
    );
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

  it('sends an all-digital checkout as digital with no address and no email', async () => {
    kinds.guide = 'file';
    const guide = digitalCartItem('guide', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [guide],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.isDigitalReady).toBe(true));
    expect(result.current.fulfillmentForItem(guide.id)).toBe('digital');
    expect(result.current.digitalKindForItem(guide.id)).toBe('file');
    expect(result.current.requiresDeliveryAddress).toBe(false);
    expect(result.current.requiresDeliveryEmail).toBe(false);
    expect(result.current.hasInstantDigitalLine).toBe(true);
    expect(result.current.hasManualDigitalLine).toBe(false);
    expect(result.current.orderCount).toBe(1);

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.lines.map((line) => line.fulfillmentChoice)).toEqual(['digital']);
    expect(command).not.toHaveProperty('deliveryAddress');
    expect(command).not.toHaveProperty('deliveryEmail');
    expect(command.fulfillmentChoiceBySeller).toEqual({});
  });

  it('requires the email for an email-kind line and sends it only then', async () => {
    kinds.pattern = 'email';
    const pattern = digitalCartItem('pattern', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [pattern],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.requiresDeliveryEmail).toBe(true));
    expect(result.current.hasManualDigitalLine).toBe(true);
    await act(async () => {
      await result.current.submit();
    });
    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('deliveryEmail').error?.message).toBe(
      'Enter the email the seller should send your purchase to.',
    );

    act(() => result.current.form.setValue('deliveryEmail', 'buyer@example'));
    await act(async () => {
      await result.current.submit();
    });
    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.deliveryEmail).toBe('buyer@example');
    expect(command).not.toHaveProperty('deliveryAddress');
  });

  it('refuses a malformed delivery email in the form', async () => {
    kinds.pattern = 'email';
    const pattern = digitalCartItem('pattern', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [pattern],
        vi.fn(async () => {}),
      ),
    );
    await waitFor(() => expect(result.current.requiresDeliveryEmail).toBe(true));
    act(() => {
      result.current.form.setValue('deliveryEmail', 'buyer at example.com');
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('deliveryEmail').error?.message).toBe('Check the email address.');
  });

  it('splits one seller’s shipped and digital lines into two orders and keeps the address', async () => {
    kinds.guide = 'file';
    const lamp = digitalCartItem('lamp', ['physical']);
    const guide = digitalCartItem('guide', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [lamp, guide],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.isDigitalReady).toBe(true));
    expect(result.current.fulfillmentForItem(lamp.id)).toBe('shipping');
    expect(result.current.fulfillmentForItem(guide.id)).toBe('digital');
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual(['shipping']);
    expect(result.current.hasFulfillmentConflict).toBe(false);
    expect(result.current.requiresDeliveryAddress).toBe(true);
    expect(result.current.orderCount).toBe(2);
    act(() => {
      fillAddress(result.current.form);
    });

    await act(async () => {
      await result.current.submit();
    });

    const command = vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mock.calls[0][0];
    expect(command.lines.map((line) => line.fulfillmentChoice)).toEqual([undefined, 'digital']);
    expect(command.fulfillmentChoiceBySeller).toEqual({ [listing.ownerPubky]: 'shipping' });
    expect(command.deliveryAddress).toEqual(expect.objectContaining({ line1: '1 Market Street' }));
  });

  it('ships a listing that offers both until the buyer picks digital delivery', async () => {
    kinds.album = 'link';
    const album = digitalCartItem('album', ['physical', 'shipping', 'digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [album],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.canChooseDigitalForItem(album.id)).toBe(true));
    expect(result.current.fulfillmentForItem(album.id)).toBe('shipping');
    expect(result.current.requiresDeliveryAddress).toBe(true);

    act(() => result.current.setDigitalChoice(album.id, true));
    await waitFor(() => expect(result.current.digitalKindForItem(album.id)).toBe('link'));
    expect(result.current.fulfillmentForItem(album.id)).toBe('digital');
    expect(result.current.requiresDeliveryAddress).toBe(false);
    expect(result.current.fulfillmentOptionsForSeller(listing.ownerPubky)).toEqual([]);
    expect(result.current.hasFulfillmentConflict).toBe(false);
  });

  it('offers no digital line on a deployment without digital delivery (B5)', async () => {
    vi.mocked(CommerceController.fetchDigitalDeliveryCapability).mockResolvedValue({
      available: false,
      maxBytes: null,
    });
    const guide = digitalCartItem('guide', ['digital']);
    const album = digitalCartItem('album', ['physical', 'shipping', 'digital'], 'z'.repeat(52));
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [guide, album],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.isDigitalCapabilityLoading).toBe(false));
    expect(result.current.fulfillmentForItem(guide.id)).toBeUndefined();
    expect(result.current.hasFulfillmentConflict).toBe(true);
    expect(result.current.canChooseDigitalForItem(album.id)).toBe(false);
    expect(result.current.fulfillmentForItem(album.id)).toBe('shipping');
  });

  it('holds a digital line unresolved while the capability loads', async () => {
    let resolve: (value: { available: boolean; maxBytes: null }) => void = () => {};
    vi.mocked(CommerceController.fetchDigitalDeliveryCapability).mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );
    kinds.guide = 'file';
    const guide = digitalCartItem('guide', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [guide],
        vi.fn(async () => {}),
      ),
    );

    expect(result.current.isDigitalCapabilityLoading).toBe(true);
    expect(result.current.isDigitalReady).toBe(false);
    expect(result.current.fulfillmentForItem(guide.id)).toBeUndefined();
    expect(result.current.hasFulfillmentConflict).toBe(false);
    expect(result.current.requiresDeliveryAddress).toBe(false);

    await act(async () => resolve({ available: true, maxBytes: null }));
    await waitFor(() => expect(result.current.isDigitalReady).toBe(true));
  });

  it('keeps Pay closed for a line whose seller has not set delivery (B4)', async () => {
    kinds.guide = null;
    const guide = digitalCartItem('guide', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [guide],
        vi.fn(async () => {}),
      ),
    );

    await waitFor(() => expect(result.current.digitalNotReadyItemIds).toEqual([guide.id]));
    expect(result.current.isDigitalReady).toBe(false);
    expect(result.current.digitalKindForItem(guide.id)).toBeNull();
  });

  it('re-reads the kind at Pay and asks for the email when the seller switched to email', async () => {
    const { toast } = await import('@/molecules/Toaster/use-toast');
    kinds.pattern = 'file';
    const pattern = digitalCartItem('pattern', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [pattern],
        vi.fn(async () => {}),
      ),
    );
    await waitFor(() => expect(result.current.isDigitalReady).toBe(true));

    kinds.pattern = 'email';
    await act(async () => {
      await result.current.submit();
    });

    expect(CommerceController.commitCreateMarketplaceCheckout).not.toHaveBeenCalled();
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: 'Enter the email the seller should send your purchase to.',
    });
    await waitFor(() => expect(result.current.requiresDeliveryEmail).toBe(true));
  });

  it('names a digital refusal from its reason and re-reads the kinds', async () => {
    const { toast } = await import('@/molecules/Toaster/use-toast');
    kinds.guide = 'file';
    const guide = digitalCartItem('guide', ['digital']);
    const { result } = renderHook(() =>
      useMarketplaceCheckout(
        [guide],
        vi.fn(async () => {}),
      ),
    );
    await waitFor(() => expect(result.current.isDigitalReady).toBe(true));
    vi.mocked(CommerceController.commitCreateMarketplaceCheckout).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'INVALID_STATE',
        message: 'SENTINEL_SERVER_TEXT_digital',
        reason: 'digital_delivery_not_ready',
      },
    } as never);
    const reads = vi.mocked(CommerceController.getMarketplaceListingProjection).mock.calls.length;

    await act(async () => {
      await result.current.submit();
    });

    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: 'error',
      description: "The seller hasn't finished setting up delivery for this item.",
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('SENTINEL_SERVER_TEXT_digital');
    await waitFor(() =>
      expect(vi.mocked(CommerceController.getMarketplaceListingProjection).mock.calls.length).toBeGreaterThan(
        reads + 1,
      ),
    );
  });
});
