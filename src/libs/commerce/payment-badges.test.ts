import { describe, expect, it } from 'vitest';
import { resolveSellerPaymentBadges } from '@/libs/commerce/payment-badges';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';

const NO_RAILS: SellerPaymentConfig = {
  bitcoinAvailable: false,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};

const config = (overrides: Partial<SellerPaymentConfig>): SellerPaymentConfig => ({ ...NO_RAILS, ...overrides });

describe('resolveSellerPaymentBadges', () => {
  it('shows nothing for a seller with no rails', () => {
    expect(resolveSellerPaymentBadges(NO_RAILS, { usdtPaymentsAvailable: true })).toEqual([]);
  });

  it('shows every enabled rail in display order', () => {
    expect(
      resolveSellerPaymentBadges(
        config({
          bitcoinAvailable: true,
          paypalAvailable: true,
          usdtAvailable: true,
          paykitAvailable: true,
          acceptedAssets: ['BTC', 'USDT'],
        }),
        { usdtPaymentsAvailable: true },
      ),
    ).toEqual(['bitcoin', 'usdt', 'paypal']);
  });

  it('reads an older service without accepted assets from the booleans', () => {
    expect(
      resolveSellerPaymentBadges(config({ bitcoinAvailable: true, usdtAvailable: true }), {
        usdtPaymentsAvailable: true,
      }),
    ).toEqual(['bitcoin', 'usdt']);
  });

  it('lets the accepted-assets list win over the booleans', () => {
    expect(
      resolveSellerPaymentBadges(config({ bitcoinAvailable: true, usdtAvailable: false, acceptedAssets: ['USDT'] }), {
        usdtPaymentsAvailable: true,
      }),
    ).toEqual(['usdt']);
  });

  it('hides USDT while the USDT gate is off, whatever the seller config says', () => {
    const usdtSeller = config({ usdtAvailable: true, paykitAvailable: true, acceptedAssets: ['USDT'] });
    expect(resolveSellerPaymentBadges(usdtSeller, { usdtPaymentsAvailable: false })).toEqual([]);
    expect(resolveSellerPaymentBadges(usdtSeller, { usdtPaymentsAvailable: false, previous: ['usdt'] })).toEqual([]);
  });

  it('keeps Bitcoin while only the rail-wide offer gate is down', () => {
    expect(
      resolveSellerPaymentBadges(config({ bitcoinAvailable: true, bitcoinOfferAvailable: false }), {
        usdtPaymentsAvailable: false,
      }),
    ).toEqual(['bitcoin']);
  });

  it('holds the last shown Paykit badges while Paykit is degraded', () => {
    const degraded = config({ bitcoinOfferAvailable: false, paypalAvailable: true, paykitUnreachable: true });
    expect(
      resolveSellerPaymentBadges(degraded, { usdtPaymentsAvailable: true, previous: ['bitcoin', 'usdt', 'paypal'] }),
    ).toEqual(['bitcoin', 'usdt', 'paypal']);
  });

  it('does not invent a Paykit badge for a seller first seen while degraded', () => {
    expect(
      resolveSellerPaymentBadges(config({ bitcoinOfferAvailable: false, paypalAvailable: true }), {
        usdtPaymentsAvailable: true,
      }),
    ).toEqual(['paypal']);
  });

  it('drops a Paykit badge at once when Paykit is healthy and says the seller is not ready', () => {
    expect(
      resolveSellerPaymentBadges(NO_RAILS, { usdtPaymentsAvailable: true, previous: ['bitcoin', 'usdt'] }),
    ).toEqual([]);
  });

  it('drops PayPal at once: it is a stored setting, never a Paykit lookup', () => {
    const degraded = config({ bitcoinOfferAvailable: false, paykitUnreachable: true });
    expect(resolveSellerPaymentBadges(degraded, { usdtPaymentsAvailable: true, previous: ['paypal'] })).toEqual([]);
  });

  it('holds USDT while the USDT capability cannot be read', () => {
    expect(resolveSellerPaymentBadges(NO_RAILS, { usdtPaymentsAvailable: null, previous: ['usdt'] })).toEqual(['usdt']);
    expect(resolveSellerPaymentBadges(NO_RAILS, { usdtPaymentsAvailable: null })).toEqual([]);
    expect(resolveSellerPaymentBadges(config({ usdtAvailable: true }), { usdtPaymentsAvailable: null })).toEqual([
      'usdt',
    ]);
  });
});
