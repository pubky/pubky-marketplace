import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SHIPS_TO_UNAVAILABLE_MESSAGE } from '@/libs/commerce/ships-to';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';
import {
  checkDestinationCountry,
  resolveSellerShipsTo,
  useMarketplaceSellerShipsTo,
} from './useMarketplaceSellerShipsTo';

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

function cached(shipsToCountries: string[] | undefined) {
  return asOpaque<Awaited<ReturnType<typeof CommerceController.getShop>>>({
    record: createCommerceShopFixture({ ownerPubky: SELLER_A, shipsToCountries }),
  });
}

describe('resolveSellerShipsTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShop.mockResolvedValue(null);
  });

  it('reads the live shop record', async () => {
    refreshShop.mockResolvedValue(createCommerceShopFixture({ ownerPubky: SELLER_A, shipsToCountries: ['CH'] }));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toEqual(['CH']);
    expect(getShop).not.toHaveBeenCalled();
  });

  it('treats a shop without a list, or no shop at all, as shipping anywhere', async () => {
    refreshShop.mockResolvedValueOnce(createCommerceShopFixture({ ownerPubky: SELLER_A }));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toBeNull();
    refreshShop.mockRejectedValueOnce(notFound);
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toBeNull();
  });

  it('keeps a cached restriction through a 404 instead of dropping it', async () => {
    refreshShop.mockRejectedValue(notFound);
    getShop.mockResolvedValue(cached(['CH']));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toEqual(['CH']);
    getShop.mockResolvedValue(cached(undefined));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toBeNull();
  });

  it('falls back to the cached record when the network read fails', async () => {
    refreshShop.mockRejectedValue(new Error('offline'));
    getShop.mockResolvedValue(cached(['CH', 'LI']));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toEqual(['CH', 'LI']);
  });

  it('is undefined when neither the network nor the cache has the record', async () => {
    refreshShop.mockRejectedValue(new Error('offline'));
    await expect(resolveSellerShipsTo(SELLER_A)).resolves.toBeUndefined();
  });
});

describe('checkDestinationCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShop.mockResolvedValue(null);
  });

  it('allows a country in the seller’s list and refuses one outside it', async () => {
    refreshShop.mockResolvedValue(createCommerceShopFixture({ ownerPubky: SELLER_A, shipsToCountries: ['CH'] }));
    await expect(checkDestinationCountry('ch', [SELLER_A])).resolves.toBeNull();
    await expect(checkDestinationCountry('DE', [SELLER_A])).resolves.toBe(
      'This seller ships only to Switzerland. Choose pickup if offered.',
    );
  });

  it('refuses when a seller’s shop cannot be read', async () => {
    refreshShop.mockRejectedValue(new Error('offline'));
    await expect(checkDestinationCountry('CH', [SELLER_A])).resolves.toBe(SHIPS_TO_UNAVAILABLE_MESSAGE);
  });

  it('allows anything for no sellers without reading any shop', async () => {
    await expect(checkDestinationCountry('DE', [])).resolves.toBeNull();
    expect(refreshShop).not.toHaveBeenCalled();
  });
});

describe('useMarketplaceSellerShipsTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShop.mockResolvedValue(null);
  });

  it('loads each seller once and intersects their lists', async () => {
    refreshShop.mockImplementation(async (pubky) =>
      createCommerceShopFixture({
        ownerPubky: pubky as string,
        shipsToCountries: pubky === SELLER_A ? ['CH', 'LI'] : ['LI', 'AT'],
      }),
    );

    const { result } = renderHook(() => useMarketplaceSellerShipsTo([SELLER_B, SELLER_A, SELLER_A]));
    expect(result.current).toEqual({ status: 'loading' });

    await waitFor(() => expect(result.current).toEqual({ status: 'ready', countries: ['LI'], restrictingSellers: 2 }));
    expect(refreshShop).toHaveBeenCalledTimes(2);
  });

  it('ships anywhere without reading when nothing is shipped', () => {
    const { result } = renderHook(() => useMarketplaceSellerShipsTo([]));
    expect(result.current).toEqual({ status: 'ready', countries: null, restrictingSellers: 0 });
    expect(refreshShop).not.toHaveBeenCalled();
  });

  it('reloads when the shipped sellers change', async () => {
    refreshShop.mockImplementation(async (pubky) =>
      createCommerceShopFixture({
        ownerPubky: pubky as string,
        shipsToCountries: pubky === SELLER_A ? ['CH'] : undefined,
      }),
    );
    const { result, rerender } = renderHook(({ sellers }) => useMarketplaceSellerShipsTo(sellers), {
      initialProps: { sellers: [SELLER_A] },
    });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', countries: ['CH'], restrictingSellers: 1 }));

    rerender({ sellers: [SELLER_B] });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', countries: null, restrictingSellers: 0 }));
  });
});
