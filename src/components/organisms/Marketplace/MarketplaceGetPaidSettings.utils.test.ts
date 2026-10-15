import { describe, expect, it } from 'vitest';
import type { SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import {
  atLeastOneMethodSentence,
  BITCOIN_TOGGLE_BLOCKER_COPY,
  countReadyPaymentMethods,
  deriveBitcoinStatus,
  deriveBitcoinToggleBlocker,
  derivePaypalStatus,
  isLockServerStepRequired,
  isReadyPaymentMethodStatus,
  type PaymentMethodStatus,
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
    const C = 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';
    it.each([
      // neither step, no errors
      { connectedCreator: null, accountClaimed: null, locksError: null, claimError: null, expected: 'not_set_up' },
      { connectedCreator: null, accountClaimed: false, locksError: null, claimError: null, expected: 'not_set_up' },
      // claim without locks
      { connectedCreator: null, accountClaimed: true, locksError: null, claimError: null, expected: 'needs_attention' },
      // locks without claim
      { connectedCreator: C, accountClaimed: null, locksError: null, claimError: null, expected: 'needs_attention' },
      { connectedCreator: C, accountClaimed: false, locksError: null, claimError: null, expected: 'needs_attention' },
      // both steps
      { connectedCreator: C, accountClaimed: true, locksError: null, claimError: null, expected: 'connected' },
      // any error → needs attention (all remaining claim/creator combos)
      {
        connectedCreator: null,
        accountClaimed: null,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: null,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: null,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: false,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: false,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: false,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: true,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: true,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: null,
        accountClaimed: true,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: null,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: null,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: null,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: false,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: false,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: false,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: true,
        locksError: 'rejected',
        claimError: null,
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: true,
        locksError: null,
        claimError: 'failed',
        expected: 'needs_attention',
      },
      {
        connectedCreator: C,
        accountClaimed: true,
        locksError: 'rejected',
        claimError: 'failed',
        expected: 'needs_attention',
      },
    ] as const)(
      'creator=$connectedCreator claimed=$accountClaimed locksError=$locksError claimError=$claimError → $expected',
      ({ expected, ...args }) => {
        expect(deriveBitcoinStatus({ accountPubky: C, lockServerRequired: true, ...args })).toBe(expected);
      },
    );

    it('does not treat a foreign Lock Server creator as Step 1 Connected', () => {
      const other = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
      expect(
        deriveBitcoinStatus({
          connectedCreator: other,
          accountPubky: C,
          accountClaimed: true,
          locksError: null,
          claimError: null,
          lockServerRequired: true,
        }),
      ).toBe('needs_attention');
    });

    it.each([
      { accountClaimed: true, claimError: null, expected: 'connected' },
      { accountClaimed: false, claimError: null, expected: 'not_set_up' },
      { accountClaimed: null, claimError: null, expected: 'not_set_up' },
      { accountClaimed: true, claimError: 'failed', expected: 'needs_attention' },
    ] as const)(
      'without the Lock Server step: claimed=$accountClaimed claimError=$claimError → $expected',
      ({ expected, ...args }) => {
        expect(
          deriveBitcoinStatus({
            connectedCreator: null,
            accountPubky: C,
            locksError: 'rejected',
            lockServerRequired: false,
            ...args,
          }),
        ).toBe(expected);
      },
    );
  });

  describe('isLockServerStepRequired', () => {
    const base = {
      paykitServerApi: 'upstream',
      hasMarketplaceSession: true,
      configLoaded: true,
      paykitAccountKnown: false,
      accountClaimed: null,
    } as const;

    it('always keeps the step on fork Paykit', () => {
      expect(isLockServerStepRequired({ ...base, paykitServerApi: 'fork', paykitAccountKnown: true })).toBe(true);
    });

    it('drops the step upstream once the service reports the Paykit account', () => {
      expect(isLockServerStepRequired({ ...base, paykitAccountKnown: true })).toBe(false);
    });

    it('drops the step upstream once Bitkit setup is confirmed another way', () => {
      expect(isLockServerStepRequired({ ...base, accountClaimed: true })).toBe(false);
    });

    it('keeps the step upstream when nothing else can confirm Bitkit setup', () => {
      expect(isLockServerStepRequired(base)).toBe(true);
      expect(isLockServerStepRequired({ ...base, accountClaimed: false })).toBe(true);
    });

    it('hides the step upstream until the session and config are loaded', () => {
      expect(isLockServerStepRequired({ ...base, hasMarketplaceSession: false })).toBe(false);
      expect(isLockServerStepRequired({ ...base, configLoaded: false })).toBe(false);
    });
  });

  describe('deriveBitcoinToggleBlocker', () => {
    it.each([
      { lockServerConnected: false, locksError: null, accountClaimed: null, expected: 'lock-server' },
      { lockServerConnected: true, locksError: 'rejected', accountClaimed: null, expected: 'lock-server' },
      { lockServerConnected: false, locksError: null, accountClaimed: false, expected: 'both' },
      { lockServerConnected: false, locksError: null, accountClaimed: true, expected: 'lock-server' },
      { lockServerConnected: true, locksError: 'rejected', accountClaimed: true, expected: 'lock-server' },
      { lockServerConnected: true, locksError: 'rejected', accountClaimed: false, expected: 'both' },
      { lockServerConnected: true, locksError: null, accountClaimed: false, expected: 'bitkit' },
      { lockServerConnected: true, locksError: null, accountClaimed: null, expected: 'bitkit-unknown' },
      { lockServerConnected: true, locksError: null, accountClaimed: true, expected: null },
    ] as const)(
      'lockServer=$lockServerConnected locksError=$locksError claimed=$accountClaimed → $expected',
      ({ expected, ...args }) => {
        expect(deriveBitcoinToggleBlocker({ lockServerRequired: true, ...args })).toBe(expected);
      },
    );

    it.each([
      { accountClaimed: false, expected: 'bitkit' },
      { accountClaimed: null, expected: 'bitkit-unknown' },
      { accountClaimed: true, expected: null },
    ] as const)('names only Bitkit without the Lock Server step: claimed=$accountClaimed', ({ expected, ...args }) => {
      expect(
        deriveBitcoinToggleBlocker({
          lockServerConnected: false,
          locksError: 'rejected',
          lockServerRequired: false,
          ...args,
        }),
      ).toBe(expected);
    });

    it('names only the missing step in its copy', () => {
      expect(BITCOIN_TOGGLE_BLOCKER_COPY['lock-server']).toBe('Connect the Lock Server first.');
      expect(BITCOIN_TOGGLE_BLOCKER_COPY.bitkit).toBe('Connect Bitkit first.');
      expect(BITCOIN_TOGGLE_BLOCKER_COPY.both).toBe('Connect the Lock Server and Bitkit first.');
    });
  });

  describe('ready-method counting', () => {
    it('counts only Connected and Email saved', () => {
      const statuses: PaymentMethodStatus[] = ['not_set_up', 'email_saved', 'connected', 'needs_attention'];
      expect(statuses.map(isReadyPaymentMethodStatus)).toEqual([false, true, true, false]);
      expect(countReadyPaymentMethods(statuses)).toBe(2);
      expect(countReadyPaymentMethods(['not_set_up', 'needs_attention', 'not_set_up'])).toBe(0);
    });

    it('writes the at-least-one sentence from the ready count only', () => {
      expect(atLeastOneMethodSentence(0)).toMatch(/^Add a payment method to start selling\./);
      expect(atLeastOneMethodSentence(1)).toMatch(/^1 payment method set up\./);
      expect(atLeastOneMethodSentence(2)).toMatch(/^2 payment methods set up\./);
      expect(atLeastOneMethodSentence(3)).toMatch(/^3 payment methods set up\./);
    });
  });
});
