import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryBoardRow } from '@/application/commerce/inventory';
import { CommerceController } from '@/controllers/commerce/commerce';
import { LISTING_PUBLISH_BLOCK_COPY } from '@/libs/commerce/listing-publish-guards';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { useMarketplaceInventory } from './useMarketplaceInventory';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (store: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: COMMERCE_FIXTURE_SELLER }),
}));

const commerce = vi.hoisted(() => ({
  durable: false,
  marketplaceSession: null as object | null,
}));

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => (commerce.durable ? 'transaction-service' : 'unavailable'),
}));

vi.mock('@/stores/commerce/commerce.store', () => ({
  useCommerceStore: (selector: (store: { marketplaceSession: object | null; inventorySession: null }) => unknown) =>
    selector({ marketplaceSession: commerce.marketplaceSession, inventorySession: null }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    loadInventoryBoard: vi.fn(),
    getOrFetchListing: vi.fn(),
    commitUpsertListing: vi.fn(),
    getSellerPaymentConfig: vi.fn(),
    getMyDeliveryKeyStatus: vi.fn(),
    setInventoryAvailable: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

function row(overrides: Partial<InventoryBoardRow> = {}): InventoryBoardRow {
  return {
    listingId: 'boots_01',
    sellerPubky: COMMERCE_FIXTURE_SELLER,
    aggregateId: `listing:${COMMERCE_FIXTURE_SELLER}_boots_01`,
    title: 'Boots',
    thumbUrl: null,
    state: 'available',
    listingState: 'paused',
    format: 'fixed_price',
    dropId: null,
    available: 4,
    reserved: 0,
    sold: 0,
    total: 4,
    serverRevision: 3,
    sync: 'synced',
    ...overrides,
  };
}

describe('useMarketplaceInventory relist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commerce.durable = false;
    commerce.marketplaceSession = null;
    vi.mocked(CommerceController.loadInventoryBoard).mockResolvedValue({ status: 'ready', rows: [row()] });
  });

  it('publishes the next revision as active and shows the row as active', async () => {
    const record = createCommerceListingFixture({ state: 'paused', revision: 4 });
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(record);
    vi.mocked(CommerceController.commitUpsertListing).mockResolvedValue({ registered: true, verified: true });
    const { result } = renderHook(() => useMarketplaceInventory());
    await waitFor(() => expect(result.current.load.status).toBe('ready'));

    let relisted = false;
    await act(async () => {
      relisted = await result.current.relist(row());
    });

    expect(relisted).toBe(true);
    expect(CommerceController.getOrFetchListing).toHaveBeenCalledWith(COMMERCE_FIXTURE_SELLER, 'boots_01');
    expect(CommerceController.commitUpsertListing).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: record.listingId, revision: 5, state: 'active' }),
    );
    expect(result.current.load).toMatchObject({
      status: 'ready',
      rows: [{ listingId: 'boots_01', listingState: 'active' }],
    });
    expect(result.current.pendingListingId).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing relisted' }));
  });

  it('asks to enable selling when the marketplace session is missing, and keeps the row paused', async () => {
    vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(
      createCommerceListingFixture({ state: 'paused' }),
    );
    vi.mocked(CommerceController.commitUpsertListing).mockRejectedValue(
      Err.auth(AuthErrorCode.SESSION_EXPIRED, 'Connect a marketplace session to publish a listing.', {
        service: ErrorService.Marketplace,
        operation: 'commitUpsertListing',
      }),
    );
    const { result } = renderHook(() => useMarketplaceInventory());
    await waitFor(() => expect(result.current.load.status).toBe('ready'));

    let relisted = true;
    await act(async () => {
      relisted = await result.current.relist(row());
    });

    expect(relisted).toBe(false);
    expect(result.current.load).toMatchObject({ status: 'ready', rows: [{ listingState: 'paused' }] });
    expect(toast).toHaveBeenCalledWith({ variant: 'error', description: LISTING_PUBLISH_BLOCK_COPY.session.title });
  });

  describe('durable publish guards', () => {
    const SESSION = { pubky: COMMERCE_FIXTURE_SELLER, capabilities: '/pub/pubky.app/:rw' };

    beforeEach(() => {
      commerce.durable = true;
      commerce.marketplaceSession = SESSION;
      vi.mocked(CommerceController.getOrFetchListing).mockResolvedValue(
        createCommerceListingFixture({ state: 'paused' }),
      );
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

    async function relist() {
      const { result } = renderHook(() => useMarketplaceInventory());
      await waitFor(() => expect(result.current.load.status).toBe('ready'));
      let relisted = true;
      await act(async () => {
        relisted = await result.current.relist(row());
      });
      return { result, relisted };
    }

    it('keeps the listing paused when the seller has no payment method', async () => {
      vi.mocked(CommerceController.getSellerPaymentConfig).mockResolvedValue({
        bitcoinAvailable: false,
        bitcoinOfferAvailable: true,
        paypalAvailable: false,
      });

      const { result, relisted } = await relist();

      expect(relisted).toBe(false);
      expect(CommerceController.commitUpsertListing).not.toHaveBeenCalled();
      expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalledWith(COMMERCE_FIXTURE_SELLER);
      expect(result.current.load).toMatchObject({ status: 'ready', rows: [{ listingState: 'paused' }] });
      expect(toast).toHaveBeenCalledWith({
        variant: 'error',
        description: LISTING_PUBLISH_BLOCK_COPY['no-method'].title,
      });
    });

    it('asks to enable selling before checking payment settings when there is no session', async () => {
      commerce.marketplaceSession = null;

      const { relisted } = await relist();

      expect(relisted).toBe(false);
      expect(CommerceController.getSellerPaymentConfig).not.toHaveBeenCalled();
      expect(CommerceController.commitUpsertListing).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: LISTING_PUBLISH_BLOCK_COPY.session.title });
    });

    it('requires a published delivery key for a listing that ships', async () => {
      vi.mocked(CommerceController.getMyDeliveryKeyStatus).mockResolvedValue({
        local: null,
        publication: 'missing',
        publishedKeyId: null,
      });

      const { relisted } = await relist();

      expect(relisted).toBe(false);
      expect(CommerceController.commitUpsertListing).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({
        variant: 'error',
        description: LISTING_PUBLISH_BLOCK_COPY['no-delivery-key'].title,
      });
    });

    it('relists once every guard passes', async () => {
      const { result, relisted } = await relist();

      expect(relisted).toBe(true);
      expect(CommerceController.commitUpsertListing).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
      expect(result.current.load).toMatchObject({ status: 'ready', rows: [{ listingState: 'active' }] });
    });
  });
});

describe('useMarketplaceInventory set stock for a size', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commerce.durable = false;
    vi.mocked(CommerceController.loadInventoryBoard).mockResolvedValue({ status: 'ready', rows: [row()] });
  });

  it('passes the size to the service and swaps in the updated row', async () => {
    const updated = row({ available: 9 });
    vi.mocked(CommerceController.setInventoryAvailable).mockResolvedValue({ status: 'updated', row: updated });
    const { result } = renderHook(() => useMarketplaceInventory());
    await waitFor(() => expect(result.current.load.status).toBe('ready'));

    await act(async () => {
      await result.current.setAvailable(row(), 9, 'size_m');
    });

    expect(CommerceController.setInventoryAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ targetAvailable: 9, variantId: 'size_m' }),
    );
    expect(result.current.load).toMatchObject({ status: 'ready', rows: [{ available: 9 }] });
  });

  it('shows the refusal for a size in a toast', async () => {
    vi.mocked(CommerceController.setInventoryAvailable).mockResolvedValue({
      status: 'error',
      message: 'This listing’s sizes changed. Refresh and try again.',
    });
    const { result } = renderHook(() => useMarketplaceInventory());
    await waitFor(() => expect(result.current.load.status).toBe('ready'));

    await act(async () => {
      await result.current.setAvailable(row(), 9, 'size_m');
    });

    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: 'This listing’s sizes changed. Refresh and try again.',
    });
  });
});
