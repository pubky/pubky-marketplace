import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { LISTING_PUBLISH_BLOCK_COPY } from '@/libs/commerce/listing-publish-guards';
import { toast } from '@/molecules/Toaster/use-toast';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { createListingProjectionFixture } from '@/test/fixtures/commerce/projections';
import { useMarketplaceSellerDashboard } from './useMarketplaceSellerDashboard';

const OWNER = 'y'.repeat(52);
const OTHER_OWNER = 'z'.repeat(52);
let currentUserPubky = OWNER;
let localListings: Array<{
  id?: string;
  state: 'active' | 'paused';
  record: ReturnType<typeof createCommerceListingFixture>;
  listing_id?: string;
  format?: string;
  price_minor?: number;
  currency?: string;
}> = [];
const adapter = vi.hoisted(() => ({ durable: false }));

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => (adapter.durable ? 'transaction-service' : 'unavailable'),
}));

const ordersState = vi.hoisted(() => ({
  orders: [] as Array<{
    order: {
      sellerPubky: string;
      state: string;
      total: { amountMinor: number; currency: string; exponent: number };
    };
  }>,
  isLoading: false,
  needsSession: false,
  error: null as string | null,
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (store: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: currentUserPubky }),
}));

vi.mock('@/hooks/useMeasurementSystem/useMeasurementSystem', () => ({
  useMeasurementSystem: () => 'metric',
}));

vi.mock('@/hooks/useMarketplaceOrders/useMarketplaceOrders', () => ({
  useMarketplaceOrders: () => ordersState,
}));

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({ offers: [], isLoading: false, needsSession: false, error: null }),
}));

let listingDraftRows: unknown[] = [];

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (querier: () => unknown) =>
    querier.toString().includes('getListingDrafts') ? listingDraftRows : localListings,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getListingsBySeller: vi.fn(async () => []),
    getOrFetchListingsBySeller: vi.fn(async () => []),
    refreshListingsBySeller: vi.fn(async () => undefined),
    fetchSellerCatalogListings: vi.fn(async () => undefined),
    getOrFetchListing: vi.fn(),
    commitUpdateListingDraft: vi.fn(),
    commitUpsertListing: vi.fn(),
    getListingDrafts: vi.fn(async () => []),
    commitDeleteListingDraft: vi.fn(),
    exportInventoryListingsCsv: vi.fn(async () => new Uint8Array()),
    getSellerPaymentConfig: vi.fn(),
    getMyDeliveryKeyStatus: vi.fn(),
    getMarketplaceListingProjection: vi.fn(),
    cacheMarketplaceListingProjection: vi.fn(async () => undefined),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

describe('useMarketplaceSellerDashboard duplicateListing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserPubky = OWNER;
    localListings = [];
    listingDraftRows = [];
    sessionStorage.removeItem('pubky.marketplace.listingDraft.resumeId');
    ordersState.orders = [];
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([]);
    vi.mocked(CommerceController.commitUpdateListingDraft).mockResolvedValue(undefined);
    vi.mocked(CommerceController.commitDeleteListingDraft).mockResolvedValue(undefined);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('018f47d2-6a27-7c23-a49d-6b21bb770999');
  });

  it('refreshes the seller catalog after rendering an empty local cache', async () => {
    const listing = createCommerceListingFixture({ listingId: 'boots_02' });
    vi.mocked(CommerceController.refreshListingsBySeller).mockImplementationOnce(async () => {
      localListings = [{ state: 'active', record: listing }];
    });
    const { result, rerender } = renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OWNER));
    rerender();

    expect(result.current.listings).toEqual([{ state: 'active', record: listing }]);
    expect(result.current.error).toBeNull();
  });

  it('reports a catalog refresh failure instead of hiding cached listings', async () => {
    const listing = createCommerceListingFixture({ listingId: 'boots_02' });
    localListings = [{ state: 'active', record: listing }];
    vi.mocked(CommerceController.refreshListingsBySeller).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() => expect(result.current.error).toBe('Could not load your listings.'));
    expect(result.current.listings).toEqual(localListings);
    expect(result.current.isLoading).toBe(false);
  });

  it('starts one background refresh while rendering cached listings immediately', async () => {
    const listing = createCommerceListingFixture({ listingId: 'boots_01' });
    localListings = [{ state: 'active', record: listing }];
    let resolveRefresh: (() => void) | undefined;
    vi.mocked(CommerceController.refreshListingsBySeller).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const { result } = renderHook(() => useMarketplaceSellerDashboard());

    expect(result.current.listings).toEqual(localListings);
    expect(result.current.isLoading).toBe(false);
    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OWNER));
    resolveRefresh?.();
  });

  it('ignores a refresh that resolves after unmount', async () => {
    let resolveRefresh: (() => void) | undefined;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(CommerceController.refreshListingsBySeller).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OWNER));
    const stateBeforeUnmount = {
      error: result.current.error,
      isLoading: result.current.isLoading,
      listings: result.current.listings,
    };
    unmount();
    resolveRefresh?.();
    await act(async () => {});

    expect({
      error: result.current.error,
      isLoading: result.current.isLoading,
      listings: result.current.listings,
    }).toEqual(stateBeforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not let seller A failure overwrite seller B state', async () => {
    let rejectA: ((error: Error) => void) | undefined;
    let resolveB: (() => void) | undefined;
    vi.mocked(CommerceController.refreshListingsBySeller)
      .mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          rejectA = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveB = resolve;
        }),
      );
    const { result, rerender } = renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OWNER));
    currentUserPubky = OTHER_OWNER;
    rerender();
    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OTHER_OWNER));

    rejectA?.(new Error('seller A failed'));
    await act(async () => {});
    expect(result.current.error).toBeNull();

    resolveB?.();
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('updates the cached listing count after refresh hydrates a newly discovered listing', async () => {
    const first = createCommerceListingFixture({ listingId: 'boots_01' });
    const second = createCommerceListingFixture({ listingId: 'boots_02' });
    const third = createCommerceListingFixture({ listingId: 'boots_03' });
    localListings = [
      { state: 'active', record: first },
      { state: 'active', record: second },
    ];
    let resolveRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = () => {
        localListings = [...localListings, { state: 'active', record: third }];
        resolve();
      };
    });
    vi.mocked(CommerceController.refreshListingsBySeller).mockReturnValueOnce(refresh);

    const { result, rerender } = renderHook(() => useMarketplaceSellerDashboard());

    expect(result.current.listings).toHaveLength(2);
    await waitFor(() => expect(CommerceController.refreshListingsBySeller).toHaveBeenCalledWith(OWNER));
    await act(async () => {
      resolveRefresh?.();
      await refresh;
    });
    rerender();

    expect(result.current.listings).toHaveLength(3);
    expect(result.current.metrics.activeListings).toBe(3);
  });

  it('seeds a new create draft from a fixed-price listing and excludes ids and revision', async () => {
    const source = createCommerceListingFixture({
      listingId: 'boots_01',
      revision: 7,
      title: 'Vintage leather boots',
      variants: [
        {
          id: 'variant_01',
          sku: 'BOOTS-42',
          options: { size: '42' },
          quantity: 4,
          mediaIds: ['image_01'],
          enabled: true,
        },
      ],
    });
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(source);

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let seeded = false;
    await act(async () => {
      seeded = await result.current.duplicateListing('boots_01');
    });

    expect(seeded).toBe(true);
    expect(CommerceController.commitUpdateListingDraft).toHaveBeenCalledOnce();
    const [draftId, form] = vi.mocked(CommerceController.commitUpdateListingDraft).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(draftId).toBe('018f47d26a277c23a49d6b21bb770999');
    expect(form).not.toHaveProperty('listingId');
    expect(form).not.toHaveProperty('revision');
    expect(form).not.toHaveProperty('media');
    expect(form).toMatchObject({
      title: 'Vintage leather boots',
      description: source.description,
      categoryId: source.categoryId,
      condition: 'good',
      saleFormat: 'fixed_price',
      currency: 'USD',
      price: '125.00',
      seededFromTitle: 'Vintage leather boots',
      seededAuctionAsFixedPrice: false,
      variants: [expect.objectContaining({ sku: 'BOOTS-42-copy', quantity: '4', size: '42' })],
    });
    expect(JSON.stringify(form)).not.toContain('boots_01');
    expect(JSON.stringify(form)).not.toContain('variant_01');
    expect(JSON.stringify(form)).not.toContain('image_01');
  });

  it('refuses to duplicate over an unsaved draft unless replaceUnsavedDraft is set', async () => {
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([unsavedDraft({ title: 'Unsaved boots' })]);
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(createCommerceListingFixture());

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let seeded = true;
    await act(async () => {
      seeded = await result.current.duplicateListing('boots_01');
    });

    expect(seeded).toBe(false);
    expect(CommerceController.commitUpdateListingDraft).not.toHaveBeenCalled();

    await act(async () => {
      seeded = await result.current.duplicateListing('boots_01', { replaceUnsavedDraft: true });
    });

    expect(seeded).toBe(true);
    expect(CommerceController.commitUpdateListingDraft).toHaveBeenCalledOnce();
    expect(CommerceController.commitDeleteListingDraft).toHaveBeenCalledWith('existingdraft');
    expect(vi.mocked(CommerceController.commitUpdateListingDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(CommerceController.commitDeleteListingDraft).mock.invocationCallOrder[0],
    );
  });

  it('leaves the old draft when seeding the replacement fails', async () => {
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([unsavedDraft({ title: 'Unsaved boots' })]);
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(createCommerceListingFixture());
    vi.mocked(CommerceController.commitUpdateListingDraft).mockRejectedValue(new Error('dexie write failed'));

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let seeded = true;
    await act(async () => {
      seeded = await result.current.duplicateListing('boots_01', { replaceUnsavedDraft: true });
    });

    expect(seeded).toBe(false);
    expect(CommerceController.commitDeleteListingDraft).not.toHaveBeenCalled();
  });

  it('keeps the new draft when deleting the old one fails', async () => {
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([unsavedDraft({ title: 'Unsaved boots' })]);
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(createCommerceListingFixture());
    vi.mocked(CommerceController.commitDeleteListingDraft).mockRejectedValue(new Error('dexie delete failed'));

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let seeded = false;
    await act(async () => {
      seeded = await result.current.duplicateListing('boots_01', {
        replaceUnsavedDraft: true,
        unsavedDraftId: 'existingdraft',
      });
    });

    expect(seeded).toBe(true);
    expect(CommerceController.commitUpdateListingDraft).toHaveBeenCalledOnce();
    expect(CommerceController.getListingDrafts).not.toHaveBeenCalled();
  });

  it('treats a photos-only draft as unsaved content', async () => {
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([
      unsavedDraft({ photos: [{ name: 'boots.jpg' }] }),
    ]);

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let draftId: string | null = null;
    await act(async () => {
      draftId = await result.current.hasUnsavedListingDraft();
    });

    expect(draftId).toBe('existingdraft');
  });

  it('ignores a default empty autosaved draft', async () => {
    vi.mocked(CommerceController.getListingDrafts).mockResolvedValue([
      unsavedDraft({
        title: '',
        description: '',
        categoryId: '',
        condition: 'good',
        price: '',
        variants: [{ sku: '', size: '', color: '', style: '', quantity: '1', priceOverride: '' }],
        shippingLabel: 'Seller shipping',
        shippingPrice: '',
        shippingMinDays: '3',
        shippingMaxDays: '7',
      }),
    ]);

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let draftId: string | null = 'existingdraft';
    await act(async () => {
      draftId = await result.current.hasUnsavedListingDraft();
    });

    expect(draftId).toBeNull();
  });

  it('counts paidOrders only for revenue states, not pending_payment', () => {
    ordersState.orders = [
      {
        order: {
          sellerPubky: OWNER,
          state: 'pending_payment',
          total: { amountMinor: 800, currency: 'USD', exponent: 2 },
        },
      },
      {
        order: {
          sellerPubky: OWNER,
          state: 'paid',
          total: { amountMinor: 900, currency: 'USD', exponent: 2 },
        },
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.metrics.paidOrders).toBe(1);
  });

  it('does not count ended auctions as active listings', () => {
    localListings = [
      {
        state: 'active',
        record: createCommerceListingFixture({
          sale: {
            format: 'auction',
            startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
            minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
            startsAt: '2020-01-01T00:00:00.000Z',
            endsAt: '2020-01-02T00:00:00.000Z',
            antiSnipingWindowSeconds: 120,
            antiSnipingExtensionSeconds: 120,
          },
        }),
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.metrics.activeListings).toBe(0);
  });

  it('copies an auction as fixed price with a notice flag', async () => {
    const source = createCommerceListingFixture({
      listingId: 'auction_01',
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
        startsAt: '2026-08-19T20:00:00.000Z',
        endsAt: '2026-08-29T20:00:00.000Z',
        antiSnipingWindowSeconds: 120,
        antiSnipingExtensionSeconds: 120,
      },
    });
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(source);

    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    await act(async () => {
      await result.current.duplicateListing('auction_01');
    });

    const form = vi.mocked(CommerceController.commitUpdateListingDraft).mock.calls[0][1] as Record<string, unknown>;
    expect(form.saleFormat).toBe('fixed_price');
    expect(form.price).toBe('45.00');
    expect(form.seededAuctionAsFixedPrice).toBe(true);
  });

  it('lists contentful unfinished drafts for the signed-in identity', () => {
    listingDraftRows = [
      unsavedDraft({ title: 'Boots' }),
      {
        ...unsavedDraft({ title: 'Jacket' }),
        id: `${OWNER}:jacketdraft`,
        listing_id: 'jacketdraft',
      },
      {
        ...unsavedDraft({}),
        id: `${OWNER}:empty`,
        listing_id: 'empty',
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.unfinishedDrafts.map((draft) => draft.listingId)).toEqual(['existingdraft', 'jacketdraft']);
    expect(result.current.unfinishedDrafts[0]?.title).toBe('Boots');
  });

  it('keeps the quantity cap out of the inventory total', () => {
    localListings = [
      {
        state: 'active',
        record: createCommerceListingFixture({
          listingId: 'guide',
          fulfillmentMethods: ['digital'],
          package: undefined,
          shippingOptions: [],
          variants: [
            {
              id: 'file',
              options: { size: 'pdf' },
              quantity: COMMERCE_LISTING_MAX_QUANTITY,
              mediaIds: ['image_01'],
              enabled: true,
            },
          ],
        }),
      },
      {
        state: 'active',
        record: createCommerceListingFixture({
          listingId: 'boots',
          variants: [
            {
              id: 'size',
              options: { size: '42' },
              quantity: 4,
              mediaIds: ['image_01'],
              enabled: true,
            },
          ],
        }),
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.metrics.totalInventory).toBe(4);
  });

  it('labels an inventory of only unlimited listings as Unlimited', () => {
    localListings = [
      {
        state: 'active',
        record: createCommerceListingFixture({
          listingId: 'guide',
          fulfillmentMethods: ['digital'],
          package: undefined,
          shippingOptions: [],
          variants: [
            {
              id: 'file',
              options: { size: 'pdf' },
              quantity: COMMERCE_LISTING_MAX_QUANTITY,
              mediaIds: ['image_01'],
              enabled: true,
            },
          ],
        }),
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.metrics.totalInventory).toBe('Unlimited');
    expect(result.current.metrics.lowStock).toBe(0);
  });

  it('still flags a numbered copy of 1 next to the unlimited cap', () => {
    const record = createCommerceListingFixture({
      listingId: 'guide',
      fulfillmentMethods: ['digital'],
      package: undefined,
      shippingOptions: [],
      variants: [
        {
          id: 'sample',
          options: { size: 'sample' },
          quantity: 1,
          mediaIds: ['image_01'],
          enabled: true,
        },
        {
          id: 'file',
          options: { size: 'pdf' },
          quantity: COMMERCE_LISTING_MAX_QUANTITY,
          mediaIds: ['image_01'],
          enabled: true,
        },
      ],
    });
    localListings = [
      {
        state: 'active',
        listing_id: 'guide',
        format: 'fixed_price',
        price_minor: 1_000,
        currency: 'USD',
        record,
      },
    ];
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    expect(result.current.metrics.lowStock).toBe(1);
  });

  describe('exportCsv', () => {
    it('returns the canonical import CSV for the signed-in seller', async () => {
      const bytes = new TextEncoder().encode('record_uri,seller_pubky\r\n');
      vi.mocked(CommerceController.exportInventoryListingsCsv).mockResolvedValue(bytes);
      const { result } = renderHook(() => useMarketplaceSellerDashboard());
      let exported: Uint8Array | null = null;
      await act(async () => {
        exported = await result.current.exportCsv();
      });
      expect(CommerceController.exportInventoryListingsCsv).toHaveBeenCalledWith(OWNER);
      expect(exported).toBe(bytes);
    });

    it('toasts and returns nothing when the export fails', async () => {
      vi.mocked(CommerceController.exportInventoryListingsCsv).mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useMarketplaceSellerDashboard());
      let exported: Uint8Array | null = new Uint8Array();
      await act(async () => {
        exported = await result.current.exportCsv();
      });
      expect(exported).toBeNull();
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not export your listings.' });
    });
  });

  it('marks a one-shot resume id without deleting the row', () => {
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    act(() => result.current.resumeListingDraft('draft_1'));
    expect(sessionStorage.getItem('pubky.marketplace.listingDraft.resumeId')).toBe('draft_1');
  });
});

describe('useMarketplaceSellerDashboard bulk activate', () => {
  const SESSION = {
    pubky: OWNER,
    capabilities: '/pub/pubky.app/:rw',
    issuedAt: '2026-10-15T00:00:00.000Z',
    expiresAt: '2026-11-15T00:00:00.000Z',
  };
  const paused = createCommerceListingFixture({ listingId: 'boots_01', state: 'paused', revision: 2 });

  beforeEach(() => {
    vi.clearAllMocks();
    adapter.durable = true;
    currentUserPubky = OWNER;
    listingDraftRows = [];
    ordersState.orders = [];
    localListings = [{ id: `${OWNER}:boots_01`, state: 'paused', record: paused }];
    useCommerceStore.setState({ marketplaceSession: SESSION });
    vi.mocked(CommerceController.commitUpsertListing).mockResolvedValue({ registered: true, verified: true });
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });
    vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockResolvedValue({
      local: null,
      publication: 'matches',
      publishedKeyId: 'key',
    });
  });

  afterEach(() => {
    adapter.durable = false;
    useCommerceStore.setState({ marketplaceSession: null });
  });

  async function update(state: 'active' | 'paused') {
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    let updated: boolean | undefined;
    await act(async () => {
      updated = await result.current.updateListingState([`${OWNER}:boots_01`], state);
    });
    return updated;
  }

  it('keeps listings paused when the seller has no payment method', async () => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });

    expect(await update('active')).toBe(false);
    expect(CommerceController.commitUpsertListing).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: LISTING_PUBLISH_BLOCK_COPY['no-method'].title,
    });
  });

  it('reads the session at call time, as after the dashboard session dialog connects', async () => {
    useCommerceStore.setState({ marketplaceSession: null });
    const { result } = renderHook(() => useMarketplaceSellerDashboard());
    useCommerceStore.setState({ marketplaceSession: SESSION });

    await act(async () => {
      await result.current.updateListingState([`${OWNER}:boots_01`], 'active');
    });

    expect(CommerceController.commitUpsertListing).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'boots_01', state: 'active', revision: 3 }),
    );
  });

  it('blocks activation of a shipped listing without a published delivery key', async () => {
    vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockResolvedValue({
      local: null,
      publication: 'missing',
      publishedKeyId: null,
    });

    expect(await update('active')).toBe(false);
    expect(CommerceController.commitUpsertListing).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: LISTING_PUBLISH_BLOCK_COPY['no-delivery-key'].title,
    });
  });

  it('pauses without running the publish guards', async () => {
    localListings = [{ id: `${OWNER}:boots_01`, state: 'active', record: { ...paused, state: 'active' } }];
    vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    });

    expect(await update('paused')).toBe(true);
    expect(CommerceController.getSellerPaymentConfig).not.toHaveBeenCalled();
    expect(CommerceController.commitUpsertListing).toHaveBeenCalledWith(expect.objectContaining({ state: 'paused' }));
  });

  it('activates once every guard passes', async () => {
    expect(await update('active')).toBe(true);
    expect(CommerceController.commitUpsertListing).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
    expect(toast).toHaveBeenCalledWith({ title: 'Listings activated' });
  });
});

function unsavedDraft(form: Record<string, unknown>) {
  return {
    id: `${OWNER}:existingdraft`,
    owner_id: OWNER,
    listing_id: 'existingdraft',
    data: { ownerPubky: OWNER, listingId: 'existingdraft', form: JSON.parse(JSON.stringify(form)) },
    created_at: 1_000,
    updated_at: 2_000,
  };
}

describe('useMarketplaceSellerDashboard stock', () => {
  afterEach(() => {
    adapter.durable = false;
    useCommerceStore.setState({ marketplaceSession: null });
  });

  it("refreshes each listing's service stock once the catalog settles, since a sale leaves the record's quantity", async () => {
    vi.clearAllMocks();
    adapter.durable = true;
    currentUserPubky = OWNER;
    listingDraftRows = [];
    const record = createCommerceListingFixture({ listingId: 'guide_01' });
    localListings = [{ id: `${OWNER}:guide_01`, listing_id: 'guide_01', state: 'active', record }];
    useCommerceStore.setState({
      marketplaceSession: {
        pubky: OWNER,
        capabilities: '/pub/pubky.app/:rw',
        issuedAt: '2026-10-15T00:00:00.000Z',
        expiresAt: '2026-11-15T00:00:00.000Z',
      },
    });
    vi.mocked(CommerceController.getListingsBySeller).mockResolvedValue(localListings as never);
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(
      createListingProjectionFixture({ aggregateId: `listing:${OWNER}_guide_01`, availableQuantity: 4 }),
    );

    renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() =>
      expect(CommerceController.cacheMarketplaceListingProjection).toHaveBeenCalledWith(
        expect.objectContaining({ id: `${OWNER}:guide_01`, available_quantity: 4 }),
      ),
    );
    expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledWith(OWNER, 'guide_01');
  });
});
