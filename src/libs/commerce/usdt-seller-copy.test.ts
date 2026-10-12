import { describe, expect, it } from 'vitest';
import { USDT_RECHECKING_NEXT_STEP_COPY, USDT_SELLER_REVIEW_COPY, usdtSellerReviewCopy } from './usdt-buyer-status';

describe('USDT seller review and re-check copy', () => {
  const review = (reviewReason?: string | null) =>
    usdtSellerReviewCopy({ state: 'manual_review', reviewReason: reviewReason ?? null });

  it('keys the seller review line to why the payment needs a decision', () => {
    expect(review('late_settlement')).toBe(USDT_SELLER_REVIEW_COPY.late_settlement);
    expect(review('amount_mismatch')).toBe(USDT_SELLER_REVIEW_COPY.amount_mismatch);
    expect(USDT_SELLER_REVIEW_COPY.late_settlement).toMatch(/arrived after the payment window ended/);
    expect(USDT_SELLER_REVIEW_COPY.amount_mismatch).toMatch(/doesn't match the order total/);
  });

  it('leaves the generic review line for every other reason, and for no payment', () => {
    expect(review('refund_required')).toBeNull();
    expect(review('unpinned_legacy')).toBeNull();
    expect(review(null)).toBeNull();
    expect(review('something_new')).toBeNull();
    expect(usdtSellerReviewCopy(null)).toBeNull();
  });

  it('names USDT, keeps the marketplace-holds-no-funds statement, and never says Bitcoin or verified', () => {
    for (const copy of Object.values(USDT_SELLER_REVIEW_COPY)) {
      expect(copy).toMatch(/USDT/);
      expect(copy).toMatch(/No funds are held by this marketplace\./);
      expect(copy).not.toMatch(/bitcoin|₿|verified/i);
    }
  });

  it('gives the seller a conditional next step in the re-checking state that follows the plan', () => {
    expect(USDT_RECHECKING_NEXT_STEP_COPY).toBe(
      "If the payment doesn't come back, check Bitkit before approving any cancellation.",
    );
    expect(USDT_RECHECKING_NEXT_STEP_COPY).not.toMatch(/bitcoin|₿|verified/i);
  });
});
