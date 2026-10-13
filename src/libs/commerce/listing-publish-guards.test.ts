import { describe, expect, it, vi } from 'vitest';
import {
  consumeListingComposerReturnTo,
  evaluateDeliveryKeyGate,
  evaluateDurableListingPublishGuards,
  evaluateSellerPaymentMethodGate,
  LISTING_COMPOSER_RETURN_INTENT_KEY,
  LISTING_PUBLISH_BLOCK_COPY,
  LISTING_PUBLISH_BLOCK_REASONS,
  listingPublishBlockToast,
  rememberListingComposerReturnTo,
} from './listing-publish-guards';

const OWNER = 'y'.repeat(52);
const emptyConfig = {
  bitcoinAvailable: false,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};
const paidConfig = {
  bitcoinAvailable: true,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};

describe('evaluateDurableListingPublishGuards', () => {
  it('blocks unsigned sellers before any payment lookup', async () => {
    const loadPaymentConfig = vi.fn();
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: null,
        hasMarketplaceSession: true,
        loadPaymentConfig,
      }),
    ).resolves.toBe('unsigned');
    expect(loadPaymentConfig).not.toHaveBeenCalled();
  });

  it('blocks a missing marketplace session before any payment lookup', async () => {
    const loadPaymentConfig = vi.fn();
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: false,
        loadPaymentConfig,
      }),
    ).resolves.toBe('session');
    expect(loadPaymentConfig).not.toHaveBeenCalled();
  });

  it('blocks when the seller has no buyer-payable method', async () => {
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => emptyConfig,
      }),
    ).resolves.toBe('no-method');
  });

  it('blocks when payment settings cannot be loaded', async () => {
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => {
          throw new Error('offline');
        },
      }),
    ).resolves.toBe('unverified');
  });

  it('returns null when a payable method is configured', async () => {
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => paidConfig,
      }),
    ).resolves.toBeNull();
  });
});

describe('delivery key guard', () => {
  it('does not read the key for a listing that does not ship', async () => {
    const loadPublication = vi.fn();
    await expect(evaluateDeliveryKeyGate({ required: false, loadPublication })).resolves.toBeNull();
    expect(loadPublication).not.toHaveBeenCalled();
  });

  it.each(['missing', 'invalid'] as const)('blocks a shipped listing when the key publication is %s', async (state) => {
    await expect(evaluateDeliveryKeyGate({ required: true, loadPublication: async () => state })).resolves.toBe(
      'no-delivery-key',
    );
  });

  it.each(['matches', 'different'] as const)('lets a shipped listing publish when a key is %s', async (state) => {
    await expect(evaluateDeliveryKeyGate({ required: true, loadPublication: async () => state })).resolves.toBeNull();
  });

  it('says the key could not be checked when the homeserver read fails', async () => {
    await expect(
      evaluateDeliveryKeyGate({
        required: true,
        loadPublication: async () => {
          throw new Error('offline');
        },
      }),
    ).resolves.toBe('delivery-key-unverified');
  });

  it('checks the key only after the seller is signed in, approved and payable', async () => {
    const loadPublication = vi.fn(async () => 'missing' as const);
    const deliveryKey = { required: true, loadPublication };

    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: null,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => paidConfig,
        deliveryKey,
      }),
    ).resolves.toBe('unsigned');
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: false,
        loadPaymentConfig: async () => paidConfig,
        deliveryKey,
      }),
    ).resolves.toBe('session');
    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => emptyConfig,
        deliveryKey,
      }),
    ).resolves.toBe('no-method');
    expect(loadPublication).not.toHaveBeenCalled();

    await expect(
      evaluateDurableListingPublishGuards({
        ownerPubky: OWNER,
        hasMarketplaceSession: true,
        loadPaymentConfig: async () => paidConfig,
        deliveryKey,
      }),
    ).resolves.toBe('no-delivery-key');
  });
});

describe('evaluateSellerPaymentMethodGate', () => {
  it('blocks unsigned sellers before any payment lookup', async () => {
    const loadPaymentConfig = vi.fn();
    await expect(evaluateSellerPaymentMethodGate({ ownerPubky: null, loadPaymentConfig })).resolves.toBe('unsigned');
    expect(loadPaymentConfig).not.toHaveBeenCalled();
  });

  it('checks payment methods even without a marketplace session', async () => {
    await expect(
      evaluateSellerPaymentMethodGate({
        ownerPubky: OWNER,
        loadPaymentConfig: async () => emptyConfig,
      }),
    ).resolves.toBe('no-method');
  });

  it('returns null when a payable method is configured', async () => {
    await expect(
      evaluateSellerPaymentMethodGate({
        ownerPubky: OWNER,
        loadPaymentConfig: async () => paidConfig,
      }),
    ).resolves.toBeNull();
  });
});

describe('listing composer return intent', () => {
  it('stores and consumes the remembered composer path', () => {
    rememberListingComposerReturnTo('/marketplace/sell');
    expect(sessionStorage.getItem(LISTING_COMPOSER_RETURN_INTENT_KEY)).toBe('/marketplace/sell');
    expect(consumeListingComposerReturnTo()).toBe('/marketplace/sell');
    expect(sessionStorage.getItem(LISTING_COMPOSER_RETURN_INTENT_KEY)).toBeNull();
  });
});

describe('listing publish-block copy', () => {
  it('covers every guard reason with a title, body, and checklist label', () => {
    expect(LISTING_PUBLISH_BLOCK_REASONS).toEqual([
      'unsigned',
      'session',
      'no-method',
      'unverified',
      'no-delivery-key',
      'delivery-key-unverified',
    ]);
    for (const reason of LISTING_PUBLISH_BLOCK_REASONS) {
      expect(LISTING_PUBLISH_BLOCK_COPY[reason].title.length).toBeGreaterThan(0);
      expect(LISTING_PUBLISH_BLOCK_COPY[reason].body.length).toBeGreaterThan(0);
      expect(LISTING_PUBLISH_BLOCK_COPY[reason].checklist.length).toBeGreaterThan(0);
      expect(listingPublishBlockToast(reason)).toEqual({
        variant: 'error',
        description: LISTING_PUBLISH_BLOCK_COPY[reason].title,
      });
    }
  });
});
