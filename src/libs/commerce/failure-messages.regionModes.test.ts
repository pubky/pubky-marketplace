import { describe, expect, it } from 'vitest';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { REGION_UNAVAILABLE_MESSAGE, SELLER_LIMIT_MESSAGE } from './eu-region';
import {
  MARKETPLACE_FAILURE_MESSAGES,
  MARKETPLACE_PAYMENT_METHOD_REASON_MESSAGES,
  marketplaceFailureMessage,
  marketplaceOfferCheckoutFailureMessage,
  marketplacePaymentMethodFailureMessage,
  marketplaceRegionRefusalMessage,
} from './failure-messages';
import { LOCKS_REGION_REFUSAL_STATUS, locksSubmitRefusalMessage } from './locks-submit-refusal';
import {
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
  SELLING_BLOCKED_MESSAGE,
} from './region-modes';

describe('the sentences the service refusals for blocked regions map to', () => {
  it('uses the sentences of the blocked-region copy', () => {
    expect(COMMERCE_BLOCKED_MESSAGE).toBe("Buying and selling aren't available in your region yet.");
    expect(SELLING_BLOCKED_MESSAGE).toBe("Selling isn't available in your region yet.");
    expect(COMMERCE_UNKNOWN_REGION_MESSAGE).toBe("We can't tell where you are, so buying and selling are paused.");
    expect(PAID_UNLOCKS_BLOCKED_MESSAGE).toBe("Paid unlocks aren't available in your region yet.");
    expect(SELLING_BLOCKED_COUNTRY_MESSAGE).toBe("Selling isn't available from this country yet.");
  });

  describe('marketplaceRegionRefusalMessage', () => {
    it.each([
      ['buyer_region_blocked', COMMERCE_BLOCKED_MESSAGE],
      ['buyer_ip_blocked', COMMERCE_BLOCKED_MESSAGE],
      ['buyer_region_unknown', COMMERCE_UNKNOWN_REGION_MESSAGE],
      [undefined, COMMERCE_BLOCKED_MESSAGE],
      ['something_new', COMMERCE_BLOCKED_MESSAGE],
    ])('maps COMMERCE_UNAVAILABLE_IN_REGION with reason %s', (reason, message) => {
      expect(marketplaceRegionRefusalMessage({ code: 'COMMERCE_UNAVAILABLE_IN_REGION', reason })).toBe(message);
    });

    it.each([
      ['seller_region_blocked', SELLING_BLOCKED_COUNTRY_MESSAGE],
      ['seller_ip_blocked', SELLING_BLOCKED_MESSAGE],
      ['private_seller_reconfirmation_required', SELLER_LIMIT_MESSAGE],
      ['business_seller', REGION_UNAVAILABLE_MESSAGE],
      [undefined, REGION_UNAVAILABLE_MESSAGE],
    ])('maps SELLER_UNAVAILABLE_IN_REGION with reason %s', (reason, message) => {
      expect(marketplaceRegionRefusalMessage({ code: 'SELLER_UNAVAILABLE_IN_REGION', reason })).toBe(message);
    });
  });

  describe('a refusal that arrives with only its code', () => {
    it('maps both codes through the general failure message', () => {
      expect(marketplaceFailureMessage('COMMERCE_UNAVAILABLE_IN_REGION', 'fallback')).toBe(COMMERCE_BLOCKED_MESSAGE);
      expect(marketplaceFailureMessage('SELLER_UNAVAILABLE_IN_REGION', 'fallback')).toBe(SELLING_BLOCKED_MESSAGE);
      expect(marketplaceFailureMessage('SOMETHING_ELSE', 'fallback')).toBe('fallback');
    });

    it('maps both codes on a failed offer checkout', () => {
      expect(marketplaceOfferCheckoutFailureMessage('COMMERCE_UNAVAILABLE_IN_REGION')).toBe(COMMERCE_BLOCKED_MESSAGE);
      expect(marketplaceOfferCheckoutFailureMessage('SELLER_UNAVAILABLE_IN_REGION')).toBe(SELLING_BLOCKED_MESSAGE);
      expect(marketplaceOfferCheckoutFailureMessage('NOPE')).toBe(MARKETPLACE_FAILURE_MESSAGES.checkout);
    });
  });

  describe('a payment-method refusal (binding a payment, preparing a Locks payment)', () => {
    const refusal = (context: Record<string, unknown>) =>
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.CONFLICT,
        message: 'service wire text that must never be shown',
        service: ErrorService.Marketplace,
        operation: 'bindPaymentMethod',
        context,
      });

    it.each([
      ['buyer_region_blocked', COMMERCE_BLOCKED_MESSAGE],
      ['buyer_ip_blocked', COMMERCE_BLOCKED_MESSAGE],
      ['buyer_region_unknown', COMMERCE_UNKNOWN_REGION_MESSAGE],
      ['seller_region_blocked', SELLING_BLOCKED_COUNTRY_MESSAGE],
      ['seller_ip_blocked', SELLING_BLOCKED_MESSAGE],
    ])('maps the reason %s', (reason, message) => {
      expect(MARKETPLACE_PAYMENT_METHOD_REASON_MESSAGES.get(reason)).toBe(message);
      expect(marketplacePaymentMethodFailureMessage(refusal({ reason }), 'fallback')).toBe(message);
    });

    it('maps a refusal that carries only the code', () => {
      expect(
        marketplacePaymentMethodFailureMessage(refusal({ serviceCode: 'COMMERCE_UNAVAILABLE_IN_REGION' }), 'fallback'),
      ).toBe(COMMERCE_BLOCKED_MESSAGE);
    });
  });

  describe('the Lock Server 451', () => {
    const locksRefusal = (statusCode: number) =>
      new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
        message: 'SENTINEL_SERVER_TEXT',
        service: ErrorService.Locks,
        operation: 'postLifecycle',
        context: { statusCode },
      });

    it('reads as paid unlocks not being available, whatever the server wrote', () => {
      expect(LOCKS_REGION_REFUSAL_STATUS).toBe(451);
      const message = locksSubmitRefusalMessage(locksRefusal(451), 'fallback');
      expect(message).toBe(PAID_UNLOCKS_BLOCKED_MESSAGE);
      expect(message).not.toContain('SENTINEL');
    });

    it('leaves other statuses to their own copy', () => {
      expect(locksSubmitRefusalMessage(locksRefusal(400), 'fallback')).toBe('fallback');
    });
  });
});
