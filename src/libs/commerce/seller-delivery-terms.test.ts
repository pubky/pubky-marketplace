import { describe, expect, it } from 'vitest';
import { COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS, COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS } from '@/config/commerce';
import {
  formatTermDays,
  resolveSellerDeliveryTerms,
  sellerDeliveryTermsCopy,
  sellerDeliveryTermsEqual,
} from './seller-delivery-terms';

describe('seller delivery terms', () => {
  it('reads both periods from the shop record', () => {
    expect(resolveSellerDeliveryTerms({ deliveryAssumeDays: 3, autoCompleteDays: 30 })).toEqual({
      deliveryAssumeDays: 3,
      autoCompleteDays: 30,
    });
  });

  it('falls back to the service defaults per field, only where the seller left one unset', () => {
    expect(resolveSellerDeliveryTerms({ autoCompleteDays: 5 })).toEqual({
      deliveryAssumeDays: COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS,
      autoCompleteDays: 5,
    });
    expect(resolveSellerDeliveryTerms({ deliveryAssumeDays: 9 })).toEqual({
      deliveryAssumeDays: 9,
      autoCompleteDays: COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS,
    });
  });

  it('shows the defaults for a seller without a shop record', () => {
    const defaults = {
      deliveryAssumeDays: COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS,
      autoCompleteDays: COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS,
    };
    expect(resolveSellerDeliveryTerms(null)).toEqual(defaults);
    expect(resolveSellerDeliveryTerms(undefined)).toEqual(defaults);
  });

  it('states both periods in one sentence, with singular days', () => {
    expect(sellerDeliveryTermsCopy({ deliveryAssumeDays: 7, autoCompleteDays: 14 })).toBe(
      'Delivery is assumed after 7 days (counted from payment for items the seller emails or sends in messages); the order completes 14 days after delivery unless you open a return.',
    );
    expect(sellerDeliveryTermsCopy({ deliveryAssumeDays: 1, autoCompleteDays: 1 })).toBe(
      'Delivery is assumed after 1 day (counted from payment for items the seller emails or sends in messages); the order completes 1 day after delivery unless you open a return.',
    );
    expect(formatTermDays(60)).toBe('60 days');
  });

  it('compares two sets of terms', () => {
    expect(
      sellerDeliveryTermsEqual(
        { deliveryAssumeDays: 3, autoCompleteDays: 5 },
        { deliveryAssumeDays: 3, autoCompleteDays: 5 },
      ),
    ).toBe(true);
    expect(
      sellerDeliveryTermsEqual(
        { deliveryAssumeDays: 3, autoCompleteDays: 5 },
        { deliveryAssumeDays: 3, autoCompleteDays: 6 },
      ),
    ).toBe(false);
  });
});
