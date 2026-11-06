import { describe, expect, it } from 'vitest';
import { bitcoinSetupClaim, type SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import {
  BITCOIN_TOGGLE_BLOCKER_COPY,
  canOfferBitkitSetup,
  deriveBitcoinStatus,
  deriveBitcoinToggleBlocker,
  derivePaypalStatus,
} from './MarketplaceGetPaidSettings.utils';

const baseConfig: SellerPaymentConfigOwnView = {
  bitcoinEnabled: false,
  paypalMerchantEmail: null,
  updatedAt: '2026-08-22T12:00:00.000Z',
};

describe('MarketplaceGetPaidSettings status derivation', () => {
  describe('derivePaypalStatus', () => {
    it.each([
      { name: 'null config', config: null, expected: 'not_set_up' },
      { name: 'empty email', config: baseConfig, expected: 'not_set_up' },
      {
        name: 'saved email',
        config: { ...baseConfig, paypalMerchantEmail: 'seller@example.com' },
        expected: 'email_saved',
      },
    ] as const)('$name → $expected', ({ config, expected }) => {
      expect(derivePaypalStatus(config)).toBe(expected);
    });
  });

  describe('deriveBitcoinStatus', () => {
    it.each([
      [true, 'connected'],
      [false, 'not_set_up'],
      [null, 'needs_attention'],
    ] as const)('claimed=%s → %s', (accountClaimed, expected) => {
      expect(deriveBitcoinStatus(accountClaimed)).toBe(expected);
    });

    it('asks a seller Paykit holds to reconnect: Needs attention, not Not set up', () => {
      expect(deriveBitcoinStatus(false, true)).toBe('needs_attention');
      expect(deriveBitcoinStatus(true, true)).toBe('connected');
      expect(deriveBitcoinStatus(null, true)).toBe('needs_attention');
    });
  });

  describe('bitcoin_setup through the derivations', () => {
    it.each([
      { bitcoinSetup: 'ready', status: 'connected', offer: true, blocker: null },
      { bitcoinSetup: 'setup_required', status: 'not_set_up', offer: true, blocker: 'bitkit' },
      { bitcoinSetup: 'unavailable', status: 'needs_attention', offer: false, blocker: 'bitkit-unknown' },
      { bitcoinSetup: undefined, status: 'needs_attention', offer: false, blocker: 'bitkit-unknown' },
    ] as const)('$bitcoinSetup → $status', ({ bitcoinSetup, status, offer, blocker }) => {
      const claimed = bitcoinSetupClaim({ bitcoinSetup });
      expect(deriveBitcoinStatus(claimed)).toBe(status);
      expect(canOfferBitkitSetup(claimed)).toBe(offer);
      expect(deriveBitcoinToggleBlocker(claimed)).toBe(blocker);
    });

    it('treats a failed read (no config) as unknown, never as Not set up', () => {
      const claimed = bitcoinSetupClaim(null);
      expect(deriveBitcoinStatus(claimed)).toBe('needs_attention');
      expect(canOfferBitkitSetup(claimed)).toBe(false);
    });
  });

  describe('deriveBitcoinToggleBlocker', () => {
    it.each([
      [false, 'bitkit'],
      [null, 'bitkit-unknown'],
      [true, null],
    ] as const)('claimed=%s → %s', (accountClaimed, expected) => {
      expect(deriveBitcoinToggleBlocker(accountClaimed)).toBe(expected);
    });

    it('asks a seller Paykit holds to reconnect, and never turns an unknown read into a step', () => {
      expect(deriveBitcoinToggleBlocker(false, true)).toBe('bitkit-reconnect');
      expect(deriveBitcoinToggleBlocker(null, true)).toBe('bitkit-unknown');
      expect(deriveBitcoinToggleBlocker(true, true)).toBeNull();
    });

    it('names only Bitkit in its copy', () => {
      expect(BITCOIN_TOGGLE_BLOCKER_COPY).toEqual({
        bitkit: 'Connect Bitkit first.',
        'bitkit-reconnect': 'Reconnect Bitkit first.',
        'bitkit-unknown': "We can't check Bitkit right now.",
      });
    });
  });
});
