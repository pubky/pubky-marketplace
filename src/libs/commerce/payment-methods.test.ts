import { describe, expect, it } from 'vitest';
import {
  availablePaymentMethods,
  isPlausibleAccountXpub,
  sellerPaykitAssets,
  sellerPaymentConfigOwnViewSchema,
  sellerPaymentConfigSchema,
} from './payment-methods';
import { PAYMENT_METHOD_KINDS } from './payment-options';

const TPUB =
  'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba';

describe('payment-methods', () => {
  describe('availablePaymentMethods', () => {
    it('renders one Paykit entry, then PayPal, and only when configured', () => {
      expect(
        availablePaymentMethods({
          bitcoinAvailable: true,
          bitcoinOfferAvailable: true,
          paypalAvailable: true,
        }),
      ).toEqual(['paykit', 'paypal']);
      expect(
        availablePaymentMethods({
          bitcoinAvailable: false,
          bitcoinOfferAvailable: true,
          paypalAvailable: false,
        }),
      ).toEqual([]);
      expect(
        availablePaymentMethods({
          bitcoinAvailable: false,
          bitcoinOfferAvailable: true,
          paypalAvailable: true,
        }),
      ).toEqual(['paypal']);
    });

    describe('USDT gate', () => {
      const base = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: true };

      it.each([
        { gate: undefined, usdtAvailable: true, expected: ['BTC'] },
        { gate: false, usdtAvailable: true, expected: ['BTC'] },
        { gate: true, usdtAvailable: undefined, expected: ['BTC'] },
        { gate: true, usdtAvailable: false, expected: ['BTC'] },
        { gate: true, usdtAvailable: true, expected: ['BTC', 'USDT'] },
      ])(
        'gate=$gate usdtAvailable=$usdtAvailable offers one Paykit entry for $expected',
        ({ gate, usdtAvailable, expected }) => {
          const config = { ...base, ...(usdtAvailable === undefined ? {} : { usdtAvailable }) };
          const options = gate === undefined ? undefined : { usdtPaymentsAvailable: gate };
          expect(availablePaymentMethods(config, options)).toEqual(['paykit', 'paypal']);
          expect(sellerPaykitAssets(config, options)).toEqual(expected);
        },
      );

      it('offers USDT on its own for a seller with no other rail, only through the gate', () => {
        const config = {
          bitcoinAvailable: false,
          bitcoinOfferAvailable: true,
          paypalAvailable: false,
          usdtAvailable: true,
        };
        expect(availablePaymentMethods(config)).toEqual([]);
        expect(availablePaymentMethods(config, { usdtPaymentsAvailable: true })).toEqual(['paykit']);
        expect(sellerPaykitAssets(config, { usdtPaymentsAvailable: true })).toEqual(['USDT']);
      });

      it('reads the offered assets from the service list and never offers USDT through a closed gate', () => {
        const config = sellerPaymentConfigSchema.parse({
          ...base,
          usdtAvailable: false,
          acceptedAssets: ['USDT', 'DOGE', 'BTC'],
        });
        expect(config.acceptedAssets).toEqual(['BTC', 'USDT']);
        expect(sellerPaykitAssets(config, { usdtPaymentsAvailable: true })).toEqual(['BTC', 'USDT']);
        expect(sellerPaykitAssets(config, { usdtPaymentsAvailable: false })).toEqual(['BTC']);
      });

      it('lets a USDT-only list offer Paykit without Bitcoin, and an empty list offer none', () => {
        const usdtOnly = sellerPaymentConfigSchema.parse({ ...base, acceptedAssets: ['USDT'], paypalAvailable: false });
        expect(sellerPaykitAssets(usdtOnly, { usdtPaymentsAvailable: true })).toEqual(['USDT']);
        expect(availablePaymentMethods(usdtOnly, { usdtPaymentsAvailable: false })).toEqual([]);
        const none = sellerPaymentConfigSchema.parse({ ...base, acceptedAssets: [], paypalAvailable: false });
        expect(availablePaymentMethods(none, { usdtPaymentsAvailable: true })).toEqual([]);
      });

      it('drops a malformed asset list and falls back to the readiness flags', () => {
        const config = sellerPaymentConfigSchema.parse({ ...base, usdtAvailable: true, acceptedAssets: 'BTC' });
        expect('acceptedAssets' in config).toBe(false);
        expect(sellerPaykitAssets(config, { usdtPaymentsAvailable: true })).toEqual(['BTC', 'USDT']);
      });

      it('removes Bitcoin when the rail-wide offer gate is off, whatever the list says', () => {
        const config = sellerPaymentConfigSchema.parse({
          ...base,
          bitcoinOfferAvailable: false,
          acceptedAssets: ['BTC', 'USDT'],
        });
        expect(sellerPaykitAssets(config, { usdtPaymentsAvailable: true })).toEqual(['USDT']);
      });
    });

    it('defaults an absent Bitcoin offer gate to available for older services', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: true,
        paypalAvailable: false,
      });

      expect(config.bitcoinOfferAvailable).toBe(true);
      expect(availablePaymentMethods(config)).toEqual(['paykit']);
    });

    it('omits Bitcoin when the rail-wide offer gate is off', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: true,
        bitcoinOfferAvailable: false,
        paypalAvailable: false,
      });

      expect(availablePaymentMethods(config)).toEqual([]);
    });

    it('lists only Paykit and PayPal, whatever else a service sends', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: true,
        bitcoinOfferAvailable: true,
        paypalAvailable: true,
        stripeAvailable: true,
      });

      expect(availablePaymentMethods(config)).toEqual(['paykit', 'paypal']);
      expect(PAYMENT_METHOD_KINDS).toEqual(['paykit', 'bitcoin', 'usdt', 'paypal']);
      expect(
        availablePaymentMethods(
          sellerPaymentConfigSchema.parse({ bitcoinAvailable: false, paypalAvailable: false, stripeAvailable: true }),
        ),
      ).toEqual([]);
    });
  });

  describe('sellerPaymentConfigSchema', () => {
    it('reads the public boolean rails', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: false,
        bitcoinOfferAvailable: true,
        paypalAvailable: true,
      });

      expect(config).toEqual({ bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: true });
      expect(availablePaymentMethods(config)).toEqual(['paypal']);
    });

    it('keeps no payout identifier from a response that still carries them', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: false,
        bitcoinOfferAvailable: true,
        paypalMerchantEmail: 'seller@example.com',
      });

      expect(config).toEqual({ bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: true });
      expect(JSON.stringify(config)).not.toMatch(/@|example\.com/);
      expect(availablePaymentMethods(config)).toEqual(['paypal']);
    });

    it('treats an absent or empty legacy email as no PayPal', () => {
      expect(
        sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, paypalMerchantEmail: null }).paypalAvailable,
      ).toBe(false);
      expect(sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, paypalMerchantEmail: '' }).paypalAvailable).toBe(
        false,
      );
      expect(sellerPaymentConfigSchema.parse({ bitcoinAvailable: true }).paypalAvailable).toBe(false);
    });

    it('lets the boolean win over a legacy email', () => {
      expect(
        sellerPaymentConfigSchema.parse({
          bitcoinAvailable: true,
          paypalAvailable: false,
          paypalMerchantEmail: 'seller@example.com',
        }).paypalAvailable,
      ).toBe(false);
    });

    it('keeps Bitcoin when the rail-wide offer gate is on', () => {
      const config = sellerPaymentConfigSchema.parse({
        bitcoinAvailable: true,
        bitcoinOfferAvailable: true,
        paypalAvailable: false,
      });

      expect(availablePaymentMethods(config)).toEqual(['paykit']);
    });
  });

  describe('isPlausibleAccountXpub', () => {
    it('accepts a real tpub and tolerates surrounding whitespace', () => {
      expect(isPlausibleAccountXpub(TPUB)).toBe(true);
      expect(isPlausibleAccountXpub(`  ${TPUB}\n`)).toBe(true);
    });

    it('rejects wrong prefixes, wrong lengths, and non-base58 content', () => {
      expect(isPlausibleAccountXpub('')).toBe(false);
      expect(isPlausibleAccountXpub('npub1abcdef')).toBe(false);
      expect(isPlausibleAccountXpub('tpubshort')).toBe(false);
      expect(isPlausibleAccountXpub(`${TPUB}0`)).toBe(false); // '0' is not base58
      expect(isPlausibleAccountXpub('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    });
  });

  describe('USDT fields on the seller configs', () => {
    it('parses an old public payload with no usdtAvailable key, exactly as before', () => {
      const parsed = sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, paypalAvailable: true });
      expect(parsed).toStrictEqual({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: true });
    });

    it('reads usdtAvailable when the service sends it and drops a malformed value', () => {
      expect(sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, usdtAvailable: true }).usdtAvailable).toBe(true);
      expect(sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, usdtAvailable: false }).usdtAvailable).toBe(
        false,
      );
      expect('usdtAvailable' in sellerPaymentConfigSchema.parse({ bitcoinAvailable: true, usdtAvailable: 'yes' })).toBe(
        false,
      );
    });

    const ownView = {
      bitcoinEnabled: true,
      paypalMerchantEmail: null,
      updatedAt: '2026-10-09T00:00:00.000Z',
    };

    it('parses an old own view with no usdtEnabled key, exactly as before', () => {
      expect(sellerPaymentConfigOwnViewSchema.parse(ownView)).toStrictEqual(ownView);
    });

    it('drops the Stripe fields a service that still stores them sends back', () => {
      const parsed = sellerPaymentConfigOwnViewSchema.parse({
        ...ownView,
        stripePaymentLink: 'https://buy.stripe.com/test_abc',
        stripeRestrictedKeySet: true,
      });
      expect(parsed).toStrictEqual(ownView);
    });

    it('reads usdtEnabled when the service sends it and drops a malformed value', () => {
      expect(sellerPaymentConfigOwnViewSchema.parse({ ...ownView, usdtEnabled: true }).usdtEnabled).toBe(true);
      expect(sellerPaymentConfigOwnViewSchema.parse({ ...ownView, usdtEnabled: 'on' }).usdtEnabled).toBeUndefined();
    });

    it('reads the USDT readiness fields and ignores them when absent', () => {
      const ready = sellerPaymentConfigOwnViewSchema.parse({
        ...ownView,
        usdtEnabled: true,
        usdtSetup: 'ready',
        usdtSetupAction: null,
      });
      expect(ready).toMatchObject({ usdtEnabled: true, usdtSetup: 'ready', usdtSetupAction: null });
      expect(sellerPaymentConfigOwnViewSchema.parse(ownView)).not.toHaveProperty('usdtSetup');
    });
  });
});
