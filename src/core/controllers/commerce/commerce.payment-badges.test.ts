import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceController } from './commerce';

const HEALTHY_ALL_RAILS: SellerPaymentConfig = {
  bitcoinAvailable: true,
  bitcoinOfferAvailable: true,
  paypalAvailable: true,
  usdtAvailable: true,
  paykitAvailable: true,
  acceptedAssets: ['BTC', 'USDT'],
};

describe('CommerceController.fetchSellerPaymentBadges', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCommerceStore.getState().reset();
  });

  it('resolves the badges and remembers them for the seller', async () => {
    const getConfig = vi.spyOn(CommerceApplication, 'getSellerPaymentConfig').mockResolvedValue(HEALTHY_ALL_RAILS);
    vi.spyOn(CommerceApplication, 'fetchUsdtPaymentsAvailable').mockResolvedValue(true);

    await expect(CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER)).resolves.toEqual([
      'bitcoin',
      'usdt',
      'paypal',
    ]);
    expect(getConfig).toHaveBeenCalledWith(COMMERCE_FIXTURE_SELLER);
    expect(useCommerceStore.getState().sellerPaymentBadges[COMMERCE_FIXTURE_SELLER]).toEqual([
      'bitcoin',
      'usdt',
      'paypal',
    ]);
  });

  it('holds the remembered Paykit badges when the next read finds Paykit degraded', async () => {
    const getConfig = vi.spyOn(CommerceApplication, 'getSellerPaymentConfig').mockResolvedValue(HEALTHY_ALL_RAILS);
    vi.spyOn(CommerceApplication, 'fetchUsdtPaymentsAvailable').mockResolvedValue(true);
    await CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER);

    getConfig.mockResolvedValue({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: false,
      paypalAvailable: true,
      usdtAvailable: false,
      paykitAvailable: false,
      acceptedAssets: [],
      paykitUnreachable: true,
    });
    await expect(CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER)).resolves.toEqual([
      'bitcoin',
      'usdt',
      'paypal',
    ]);
  });

  it('keeps the remembered badges when the read fails, and returns null before any read succeeded', async () => {
    const getConfig = vi
      .spyOn(CommerceApplication, 'getSellerPaymentConfig')
      .mockRejectedValue(new TypeError('service unreachable'));
    vi.spyOn(CommerceApplication, 'fetchUsdtPaymentsAvailable').mockResolvedValue(false);

    await expect(CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER)).resolves.toBeNull();
    expect(useCommerceStore.getState().sellerPaymentBadges).toEqual({});

    getConfig.mockResolvedValueOnce({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false });
    await CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER);
    await expect(CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER)).resolves.toEqual(['bitcoin']);
    expect(useCommerceStore.getState().sellerPaymentBadges[COMMERCE_FIXTURE_SELLER]).toEqual(['bitcoin']);
  });

  it('treats an unreadable USDT capability as unknown, not as off', async () => {
    vi.spyOn(CommerceApplication, 'getSellerPaymentConfig').mockResolvedValue(HEALTHY_ALL_RAILS);
    vi.spyOn(CommerceApplication, 'fetchUsdtPaymentsAvailable').mockRejectedValue(new TypeError('health unreadable'));

    await expect(CommerceController.fetchSellerPaymentBadges(COMMERCE_FIXTURE_SELLER)).resolves.toEqual([
      'bitcoin',
      'usdt',
      'paypal',
    ]);
  });

  it('rejects an invalid seller key before any read', async () => {
    const getConfig = vi.spyOn(CommerceApplication, 'getSellerPaymentConfig');

    await expect(CommerceController.fetchSellerPaymentBadges('not-a-pubky')).rejects.toThrow();
    expect(getConfig).not.toHaveBeenCalled();
  });
});
