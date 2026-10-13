import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceSellerDeliveryTerms } from './useMarketplaceSellerDeliveryTerms';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    refreshShop: vi.fn(),
    getShop: vi.fn(),
  },
}));

const SELLER_A = 'a'.repeat(52);
const SELLER_B = 'b'.repeat(52);

const refreshShop = vi.mocked(CommerceController.refreshShop);
const getShop = vi.mocked(CommerceController.getShop);

const notFound = new AppError({
  category: ErrorCategory.Client,
  code: ClientErrorCode.NOT_FOUND,
  message: 'No shop',
  service: ErrorService.Homeserver,
  operation: 'getOwnedResponse',
  context: { statusCode: 404 },
});

describe('useMarketplaceSellerDeliveryTerms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShop.mockResolvedValue(null);
  });

  it('resolves each seller from the live shop record, filling only unset periods with the defaults', async () => {
    refreshShop.mockImplementation(async (pubky) =>
      pubky === SELLER_A
        ? createCommerceShopFixture({
            ownerPubky: SELLER_A,
            name: 'Shop A',
            deliveryAssumeDays: 3,
            autoCompleteDays: 5,
          })
        : createCommerceShopFixture({ ownerPubky: SELLER_B, name: 'Shop B', autoCompleteDays: 9 }),
    );

    const { result } = renderHook(() => useMarketplaceSellerDeliveryTerms([SELLER_B, SELLER_A, SELLER_A]));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(refreshShop).toHaveBeenCalledTimes(2);
    expect(result.current.entries).toEqual([
      { sellerPubky: SELLER_A, shopName: 'Shop A', terms: { deliveryAssumeDays: 3, autoCompleteDays: 5 } },
      { sellerPubky: SELLER_B, shopName: 'Shop B', terms: { deliveryAssumeDays: 14, autoCompleteDays: 9 } },
    ]);
  });

  it('shows the defaults for a seller with no shop record', async () => {
    refreshShop.mockRejectedValue(notFound);

    const { result } = renderHook(() => useMarketplaceSellerDeliveryTerms([SELLER_A]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([
      { sellerPubky: SELLER_A, shopName: null, terms: { deliveryAssumeDays: 14, autoCompleteDays: 14 } },
    ]);
  });

  it('falls back to the cached record when the network read fails', async () => {
    refreshShop.mockRejectedValue(new Error('offline'));
    getShop.mockResolvedValue(
      asOpaque<Awaited<ReturnType<typeof CommerceController.getShop>>>({
        record: createCommerceShopFixture({
          ownerPubky: SELLER_A,
          name: 'Cached',
          deliveryAssumeDays: 7,
          autoCompleteDays: 8,
        }),
      }),
    );

    const { result } = renderHook(() => useMarketplaceSellerDeliveryTerms([SELLER_A]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([
      { sellerPubky: SELLER_A, shopName: 'Cached', terms: { deliveryAssumeDays: 7, autoCompleteDays: 8 } },
    ]);
  });

  it('leaves out a seller whose record cannot be read at all', async () => {
    refreshShop.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useMarketplaceSellerDeliveryTerms([SELLER_A]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([]);
  });

  it('does nothing without sellers', () => {
    const { result } = renderHook(() => useMarketplaceSellerDeliveryTerms([]));

    expect(result.current).toEqual({ isLoading: false, entries: [] });
    expect(refreshShop).not.toHaveBeenCalled();
  });
});
