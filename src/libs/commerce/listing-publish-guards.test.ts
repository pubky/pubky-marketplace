import { describe, expect, it, vi } from 'vitest';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import {
  consumeListingComposerReturnTo,
  evaluateDeliveryKeyGate,
  evaluateDurableListingPublishGuards,
  evaluateSellerPaymentMethodGate,
  LISTING_COMPOSER_RETURN_INTENT_KEY,
  LISTING_PUBLISH_BLOCK_COPY,
  LISTING_PUBLISH_BLOCK_REASONS,
  listingPublishBlockToast,
  listingPublishNeedsMarketplaceSession,
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

describe('listingPublishNeedsMarketplaceSession', () => {
  const active = createCommerceListingFixture();
  const pause = (
    record: CommerceListingRecord,
    changes: Partial<CommerceListingRecord> = {},
  ): CommerceListingRecord => ({
    ...record,
    revision: record.revision + 1,
    state: 'paused',
    updatedAt: '2026-10-15T08:00:00.000Z',
    ...changes,
  });

  it('lets a pure pause of an active fixed-price listing through on the sign-in grant alone', () => {
    expect(listingPublishNeedsMarketplaceSession(active, pause(active))).toBe(false);
  });

  it('needs the session when a pause also edits the listing', () => {
    expect(listingPublishNeedsMarketplaceSession(active, pause(active, { title: 'Renamed boots' }))).toBe(true);
  });

  it('needs the session to edit a listing that is already paused', () => {
    const paused = pause(active);
    expect(listingPublishNeedsMarketplaceSession(paused, pause(paused, { title: 'Renamed boots' }))).toBe(true);
  });

  it('needs the session without a local record to compare', () => {
    expect(listingPublishNeedsMarketplaceSession(undefined, pause(active))).toBe(true);
  });

  it.each(['active', 'ended', 'removed'] as const)('needs the session to publish a listing as %s', (state) => {
    expect(listingPublishNeedsMarketplaceSession(active, { ...pause(active), state })).toBe(true);
  });

  it('needs the session to pause an auction', () => {
    const auction: CommerceListingRecord = {
      ...active,
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-17T00:00:00.000Z',
        antiSnipingWindowSeconds: 120,
        antiSnipingExtensionSeconds: 120,
      },
    };
    expect(listingPublishNeedsMarketplaceSession(auction, pause(auction))).toBe(true);
  });
});

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

  it('reports a Paykit outage instead of asking the seller to add a payment method', async () => {
    await expect(
      evaluateSellerPaymentMethodGate({
        ownerPubky: OWNER,
        loadPaymentConfig: async () => ({ ...emptyConfig, paykitUnreachable: true }),
      }),
    ).resolves.toBe('paykit-unreachable');
  });

  it('lets a seller with another working method through during a Paykit outage', async () => {
    await expect(
      evaluateSellerPaymentMethodGate({
        ownerPubky: OWNER,
        loadPaymentConfig: async () => ({
          bitcoinAvailable: false,
          bitcoinOfferAvailable: false,
          paypalAvailable: true,
          paykitUnreachable: true,
        }),
      }),
    ).resolves.toBeNull();
  });

  it('recovers to null once Paykit and the seller method are back', async () => {
    const loadPaymentConfig = vi
      .fn()
      .mockResolvedValueOnce({ ...emptyConfig, paykitUnreachable: true })
      .mockResolvedValueOnce(paidConfig);
    const input = { ownerPubky: OWNER, loadPaymentConfig };
    await expect(evaluateSellerPaymentMethodGate(input)).resolves.toBe('paykit-unreachable');
    await expect(evaluateSellerPaymentMethodGate(input)).resolves.toBeNull();
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
      'paykit-unreachable',
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
        description:
          reason === 'paykit-unreachable'
            ? 'Paykit is temporarily unreachable. Try again in a moment.'
            : LISTING_PUBLISH_BLOCK_COPY[reason].title,
      });
    }
  });

  it('words the Paykit outage as a calm retry that leaves the seller setup alone', () => {
    expect(LISTING_PUBLISH_BLOCK_COPY['paykit-unreachable'].title).toBe('Paykit is temporarily unreachable, retrying…');
    expect(LISTING_PUBLISH_BLOCK_COPY['paykit-unreachable'].body).toMatch(/payment settings are unchanged/i);
    expect(LISTING_PUBLISH_BLOCK_COPY['paykit-unreachable'].title).not.toMatch(/add a payment method/i);
  });
});
