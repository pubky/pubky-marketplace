// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { purchaseFailure } from './listing-purchase.mjs';

describe('purchaseFailure', () => {
  it('passes when Buy put the listing straight into the cart', () => {
    expect(purchaseFailure({ buyEnabled: true, enablePurchases: false, cartHasCheckout: true })).toBeNull();
  });

  it('passes when the Enable purchases approval completed and the pending add landed in the cart', () => {
    expect(
      purchaseFailure({
        buyEnabled: true,
        enablePurchases: true,
        approvalLink: true,
        dialogClosed: true,
        cartHasCheckout: true,
      }),
    ).toBeNull();
  });

  it('fails when there is no enabled Buy button', () => {
    expect(purchaseFailure({ buyEnabled: false, enablePurchases: false, cartHasCheckout: false })).toMatch(
      /no enabled Buy button/,
    );
  });

  it('fails when Enable purchases offers nothing to approve', () => {
    expect(
      purchaseFailure({ buyEnabled: true, enablePurchases: true, approvalLink: false, cartHasCheckout: false }),
    ).toMatch(/without an authorization link/);
  });

  it('fails when Enable purchases stays open after the approval', () => {
    expect(
      purchaseFailure({
        buyEnabled: true,
        enablePurchases: true,
        approvalLink: true,
        dialogClosed: false,
        cartHasCheckout: false,
      }),
    ).toMatch(/did not close/);
  });

  it('fails when the cart has no checkout control, naming the path taken', () => {
    expect(purchaseFailure({ buyEnabled: true, enablePurchases: false, cartHasCheckout: false })).toBe(
      'the listing was not in the cart after Buy',
    );
    expect(
      purchaseFailure({
        buyEnabled: true,
        enablePurchases: true,
        approvalLink: true,
        dialogClosed: true,
        cartHasCheckout: false,
      }),
    ).toBe('the listing was not in the cart after the "Enable purchases" approval');
  });
});
