import { describe, expect, it } from 'vitest';
import { createPaykitOrderFixture } from '@/test/fixtures/commerce/paykit-orders';
import { createUsdtOrderFixture } from '@/test/fixtures/commerce/usdt-orders';
import {
  CHECKOUT_SUBMIT_LABEL,
  followsBitcoinFlow,
  isPaykitOrder,
  isUnobservedPaykitOrder,
  mayPayInBitcoin,
  observedPaymentRail,
  orderOfferedAssets,
  PAYKIT_OUTAGE_COPY,
  PAYKIT_RAIL_STALE_AGE_SECONDS,
  paykitAssetsLabel,
  paykitAwaitingBody,
  paykitAwaitingTitle,
  paykitPickerLabel,
  paykitRailStatusFromHealth,
  paykitRetryDelayMs,
  sharedPaykitAssets,
  unboundOrderMayPayInUsdt,
} from './paykit-rail';

describe('observedPaymentRail', () => {
  it('keys a single-bind order off the observed asset, never the method', () => {
    expect(observedPaymentRail({ paymentMethod: 'paykit', paymentAsset: 'BTC' })).toBe('bitcoin');
    expect(observedPaymentRail({ paymentMethod: 'paykit', paymentAsset: 'USDT' })).toBe('usdt');
    expect(observedPaymentRail({ paymentMethod: 'paykit', paymentAsset: null })).toBeNull();
    expect(observedPaymentRail({ paymentMethod: 'paykit' })).toBeNull();
  });

  it('falls back to the legacy method for an order placed before the single bind', () => {
    expect(observedPaymentRail({ paymentMethod: 'bitcoin' })).toBe('bitcoin');
    expect(observedPaymentRail({ paymentMethod: 'bitcoin', paymentAsset: null })).toBe('bitcoin');
    expect(observedPaymentRail({ paymentMethod: 'usdt', paymentAsset: 'USDT' })).toBe('usdt');
  });

  it('is null for PayPal, unbound and unknown orders', () => {
    expect(observedPaymentRail({ paymentMethod: 'paypal' })).toBeNull();
    expect(observedPaymentRail({ paymentMethod: null })).toBeNull();
    expect(observedPaymentRail({ paymentMethod: 'paykit', paymentAsset: 'DAI' })).toBeNull();
  });

  it('follows the rail the buyer actually paid on, whatever the offer was', () => {
    for (const [phase, rail] of [
      ['unpaid', null],
      ['paid-bitcoin', 'bitcoin'],
      ['paid-usdt', 'usdt'],
    ] as const) {
      expect(observedPaymentRail(createPaykitOrderFixture(phase).order)).toBe(rail);
    }
    expect(observedPaymentRail(createUsdtOrderFixture('final').order)).toBe('usdt');
  });
});

describe('Paykit order predicates', () => {
  it('recognises single-bind and legacy Paykit orders, not PayPal', () => {
    expect(isPaykitOrder({ paymentMethod: 'paykit' })).toBe(true);
    expect(isPaykitOrder({ paymentMethod: 'bitcoin' })).toBe(true);
    expect(isPaykitOrder({ paymentMethod: 'usdt' })).toBe(true);
    expect(isPaykitOrder({ paymentMethod: 'paypal' })).toBe(false);
    expect(isPaykitOrder({ paymentMethod: null })).toBe(false);
  });

  it('calls a single-bind order unobserved until a rail is seen', () => {
    expect(isUnobservedPaykitOrder({ paymentMethod: 'paykit', paymentAsset: null })).toBe(true);
    expect(isUnobservedPaykitOrder({ paymentMethod: 'paykit', paymentAsset: 'USDT' })).toBe(false);
    expect(isUnobservedPaykitOrder({ paymentMethod: 'bitcoin' })).toBe(false);
  });

  it('lets Bitcoin be the rail on an observed Bitcoin order or an unobserved single bind, never on USDT', () => {
    expect(mayPayInBitcoin({ paymentMethod: 'paykit', paymentAsset: null })).toBe(true);
    expect(mayPayInBitcoin({ paymentMethod: 'paykit', paymentAsset: 'BTC' })).toBe(true);
    expect(mayPayInBitcoin({ paymentMethod: 'bitcoin' })).toBe(true);
    expect(mayPayInBitcoin({ paymentMethod: 'paykit', paymentAsset: 'USDT' })).toBe(false);
    expect(mayPayInBitcoin({ paymentMethod: 'usdt' })).toBe(false);
    expect(mayPayInBitcoin({ paymentMethod: 'paypal' })).toBe(false);
  });

  it('puts an unobserved single bind on the Bitcoin tables only once its request is seen', () => {
    const unpaid = { paymentMethod: 'paykit', paymentAsset: null };
    expect(followsBitcoinFlow({ ...unpaid, paykitRequestState: 'pending' })).toBe(false);
    expect(followsBitcoinFlow({ ...unpaid, paykitRequestState: 'preparing' })).toBe(false);
    expect(followsBitcoinFlow({ ...unpaid, paykitRequestState: null })).toBe(false);
    for (const state of ['detected', 'awaiting_seller_confirmation', 'confirmed']) {
      expect(followsBitcoinFlow({ ...unpaid, paykitRequestState: state })).toBe(true);
    }
    expect(followsBitcoinFlow({ paymentMethod: 'bitcoin', paykitRequestState: 'pending' })).toBe(true);
    expect(followsBitcoinFlow({ paymentMethod: 'paykit', paymentAsset: 'USDT', paykitRequestState: 'detected' })).toBe(
      false,
    );
  });
});

describe('unboundOrderMayPayInUsdt', () => {
  it('follows the assets the picker offers while no method is bound', () => {
    expect(unboundOrderMayPayInUsdt({ paymentMethod: null }, ['BTC', 'USDT'])).toBe(true);
    expect(unboundOrderMayPayInUsdt({ paymentMethod: null }, ['BTC'])).toBe(false);
  });

  it('counts USDT as possible until the offered assets load', () => {
    expect(unboundOrderMayPayInUsdt({ paymentMethod: null }, null)).toBe(true);
  });

  it('leaves a bound order to its own assets', () => {
    expect(unboundOrderMayPayInUsdt({ paymentMethod: 'paykit' }, ['BTC', 'USDT'])).toBe(false);
    expect(unboundOrderMayPayInUsdt({ paymentMethod: 'paypal' }, null)).toBe(false);
  });
});

describe('Paykit copy', () => {
  it('names the assets on offer, Bitcoin first', () => {
    expect(paykitAssetsLabel(['BTC'])).toBe('Bitcoin');
    expect(paykitAssetsLabel(['USDT'])).toBe('USDT');
    expect(paykitAssetsLabel(['USDT', 'BTC'])).toBe('Bitcoin or USDT');
    expect(paykitAssetsLabel([])).toBe('Bitkit');
  });

  it('labels the single picker entry by asset and wallet, never as a Pay action', () => {
    expect(paykitPickerLabel(['BTC'])).toEqual({ assets: 'Bitcoin', wallet: 'via Bitkit' });
    expect(paykitPickerLabel(['USDT', 'BTC'])).toEqual({ assets: 'Bitcoin or USDT', wallet: 'via Bitkit' });
    expect(paykitPickerLabel(['USDT'])).toEqual({ assets: 'USDT', wallet: 'via Bitkit' });
    expect(paykitPickerLabel([])).toEqual({ assets: 'Bitcoin', wallet: 'via Bitkit' });
  });

  it('names the next step on the checkout submit button for each rail', () => {
    expect(CHECKOUT_SUBMIT_LABEL).toEqual({ paykit: 'Send request to Bitkit', paypal: 'Continue to PayPal' });
  });

  it('shows the neutral pay-in-Bitkit state before any rail is seen', () => {
    expect(paykitAwaitingTitle(['BTC', 'USDT'])).toBe('Pay in Bitkit (Bitcoin or USDT)');
    expect(paykitAwaitingTitle(['BTC'])).toBe('Pay in Bitkit (Bitcoin)');
    expect(paykitAwaitingBody(['BTC', 'USDT'])).toContain('choose Bitcoin or USDT');
    expect(paykitAwaitingBody(['BTC'])).not.toMatch(/choose|USDT/);
  });

  it('reads the offer from the order, defaulting an order that carries none to Bitcoin', () => {
    expect(orderOfferedAssets({ acceptedAssets: ['BTC', 'USDT'] })).toEqual(['BTC', 'USDT']);
    expect(orderOfferedAssets({ acceptedAssets: ['USDT'] })).toEqual(['USDT']);
    expect(orderOfferedAssets({ acceptedAssets: [] })).toEqual(['BTC']);
    expect(orderOfferedAssets({})).toEqual(['BTC']);
  });

  it('names only the assets every seller in a cart accepts', () => {
    expect(
      sharedPaykitAssets([
        ['BTC', 'USDT'],
        ['BTC', 'USDT'],
      ]),
    ).toEqual(['BTC', 'USDT']);
    expect(sharedPaykitAssets([['BTC', 'USDT'], ['BTC']])).toEqual(['BTC']);
    expect(sharedPaykitAssets([['BTC'], ['USDT']])).toEqual([]);
    expect(sharedPaykitAssets([])).toEqual([]);
  });
});

describe('paykitRailStatusFromHealth', () => {
  it('is ready for a fresh good probe', () => {
    expect(paykitRailStatusFromHealth({ paykitRail: { bitcoinOfferAvailable: true, ageSeconds: 12 } })).toBe('ready');
  });

  it('is unreachable when the last probe says the rail is down', () => {
    expect(paykitRailStatusFromHealth({ paykitRail: { bitcoinOfferAvailable: false, ageSeconds: 3 } })).toBe(
      'unreachable',
    );
  });

  it('is unreachable when the last good probe is older than the stale window, so every probe since failed', () => {
    expect(
      paykitRailStatusFromHealth({
        paykitRail: { bitcoinOfferAvailable: true, ageSeconds: PAYKIT_RAIL_STALE_AGE_SECONDS + 1 },
      }),
    ).toBe('unreachable');
    expect(
      paykitRailStatusFromHealth({
        paykitRail: { bitcoinOfferAvailable: true, ageSeconds: PAYKIT_RAIL_STALE_AGE_SECONDS },
      }),
    ).toBe('ready');
  });

  it.each([
    ['no paykitRail', {}],
    ['a rail that never succeeded', { paykitRail: { bitcoinOfferAvailable: null, ageSeconds: null } }],
  ])('is unknown for %s, which says nothing about an outage', (_, health) => {
    expect(paykitRailStatusFromHealth(health)).toBe('unknown');
  });
});

describe('paykitRetryDelayMs', () => {
  it('backs off 5s, 10s, 20s and then holds at 30s', () => {
    expect([0, 1, 2, 3, 4, 50].map(paykitRetryDelayMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });
});

describe('PAYKIT_OUTAGE_COPY', () => {
  it('is calm, honest and never blames the user setup', () => {
    expect(PAYKIT_OUTAGE_COPY.title).toBe('Paykit is temporarily unreachable, retrying…');
    for (const copy of Object.values(PAYKIT_OUTAGE_COPY)) {
      expect(copy).not.toMatch(/add a payment method|unavailable page/i);
    }
  });
});

describe('PAYKIT_OUTAGE_COPY for the single Paykit entry', () => {
  it('names no rail, so a Bitcoin-or-USDT buyer reads the same calm line', () => {
    expect(PAYKIT_OUTAGE_COPY.buyerBody).not.toMatch(/bitcoin|usdt|btc/i);
    expect(PAYKIT_OUTAGE_COPY.buyerOthers).not.toMatch(/bitcoin|usdt|btc/i);
    expect(PAYKIT_OUTAGE_COPY.title).not.toMatch(/bitcoin|usdt|btc/i);
  });
});
