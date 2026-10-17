import { afterEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import { CommerceApplication } from './commerce';

const seller = (index: number) => String.fromCharCode(97 + (index % 26)).repeat(51) + 'y';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommerceApplication.fetchPaymentMethodSellers', () => {
  it('collects every page until the service reports none left', async () => {
    const page = vi
      .spyOn(MarketplaceGatewayService, 'getPaymentMethodSellers')
      .mockResolvedValueOnce({ method: 'paypal', sellers: [seller(0), seller(1)], nextAfter: seller(1) })
      .mockResolvedValueOnce({ method: 'paypal', sellers: [seller(2)], nextAfter: null });

    await expect(CommerceApplication.fetchPaymentMethodSellers('paypal')).resolves.toEqual([
      seller(0),
      seller(1),
      seller(2),
    ]);
    expect(page.mock.calls).toEqual([
      ['paypal', null],
      ['paypal', seller(1)],
    ]);
  });

  it('stops after the page cap even if the service has more', async () => {
    const page = vi
      .spyOn(MarketplaceGatewayService, 'getPaymentMethodSellers')
      .mockImplementation(async (method, after) => ({
        method,
        sellers: [seller(after ? 9 : 0)],
        nextAfter: seller(9),
      }));

    const sellers = await CommerceApplication.fetchPaymentMethodSellers('bitcoin');
    expect(page).toHaveBeenCalledTimes(4);
    expect(sellers).toHaveLength(4);
  });

  it('rejects when a page cannot be read', async () => {
    vi.spyOn(MarketplaceGatewayService, 'getPaymentMethodSellers').mockRejectedValue(new TypeError('offline'));
    await expect(CommerceApplication.fetchPaymentMethodSellers('usdt')).rejects.toThrow('offline');
  });
});

describe('CommerceApplication.fetchSellerSetCatalogListings', () => {
  it('reads one seller-scoped stream page per seller with the server-side filters', async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    const stream = vi.spyOn(NexusMarketplaceService, 'fetchListingStream').mockResolvedValue([]);

    await CommerceApplication.fetchSellerSetCatalogListings([seller(0), seller(1)], { saleFormat: 'auction' });

    expect(stream.mock.calls.map(([params]) => params)).toEqual([
      { state: 'active', limit: 30, sale_format: 'auction', seller_id: seller(0) },
      { state: 'active', limit: 30, sale_format: 'auction', seller_id: seller(1) },
    ]);
  });

  it('keeps going when one seller cannot be read, at most four at a time', async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    let inFlight = 0;
    let peak = 0;
    const fetch = vi.spyOn(CommerceApplication, 'fetchCatalogListings').mockImplementation(async (filters) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (filters?.sellerId === seller(2)) throw new TypeError('nexus down');
    });
    const sellers = Array.from({ length: 9 }, (_, index) => seller(index));

    await expect(CommerceApplication.fetchSellerSetCatalogListings(sellers)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(9);
    expect(peak).toBe(4);
  });
});
