import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { CommerceController } from './commerce';

const seller = (index: number) => String.fromCharCode(97 + (index % 26)).repeat(51) + 'y';
const ANY = { saleFormat: 'all' as const, conditions: [], sort: 'newest' as const, countryCode: null };

describe('CommerceController.fetchPaymentMethodCatalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCommerceStore.getState().reset();
  });

  it('remembers the seller set and discovers the listings of the first 24 sellers', async () => {
    const sellers = Array.from({ length: 30 }, (_, index) => seller(index));
    vi.spyOn(CommerceApplication, 'fetchPaymentMethodSellers').mockResolvedValue(sellers);
    const discover = vi.spyOn(CommerceApplication, 'fetchSellerSetCatalogListings').mockResolvedValue();

    await expect(CommerceController.fetchPaymentMethodCatalog('paypal', ANY)).resolves.toEqual(sellers);

    expect(useCommerceStore.getState().paymentMethodSellers.paypal).toEqual(sellers);
    expect(discover).toHaveBeenCalledWith(sellers.slice(0, 24), {});
  });

  it('carries the server-side catalog filters into discovery', async () => {
    vi.spyOn(CommerceApplication, 'fetchPaymentMethodSellers').mockResolvedValue([seller(0)]);
    const discover = vi.spyOn(CommerceApplication, 'fetchSellerSetCatalogListings').mockResolvedValue();

    await CommerceController.fetchPaymentMethodCatalog('bitcoin', {
      saleFormat: 'auction',
      conditions: ['good'],
      sort: 'ending_soon',
      countryCode: 'CH',
    });

    expect(discover).toHaveBeenCalledWith([seller(0)], {
      saleFormat: 'auction',
      condition: 'good',
      endingSoonest: true,
      country: 'CH',
    });
  });

  it('leaves the remembered set untouched and rejects when the set cannot be read', async () => {
    useCommerceStore.getState().setPaymentMethodSellers('usdt', [seller(1)]);
    vi.spyOn(CommerceApplication, 'fetchPaymentMethodSellers').mockRejectedValue(new TypeError('offline'));
    const discover = vi.spyOn(CommerceApplication, 'fetchSellerSetCatalogListings');

    await expect(CommerceController.fetchPaymentMethodCatalog('usdt', ANY)).rejects.toThrow('offline');

    expect(useCommerceStore.getState().paymentMethodSellers.usdt).toEqual([seller(1)]);
    expect(discover).not.toHaveBeenCalled();
  });
});
