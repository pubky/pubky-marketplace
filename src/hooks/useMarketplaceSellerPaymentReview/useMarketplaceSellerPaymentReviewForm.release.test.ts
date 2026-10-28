import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useMarketplaceSellerPaymentReviewForm } from './useMarketplaceSellerPaymentReviewForm';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    confirmBitcoinPayment: vi.fn(async () => ({ order: null, confirmation: {} })),
    resolveBitcoinPayment: vi.fn(),
  },
}));

describe('useMarketplaceSellerPaymentReviewForm → CommerceController (release with the confirmation)', () => {
  beforeEach(() => {
    vi.mocked(CommerceController.confirmBitcoinPayment).mockClear();
  });

  it.each([true, false])('hands releaseDigital=%s through to confirmBitcoinPayment', async (releaseDigital) => {
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useMarketplaceSellerPaymentReviewForm('order-1', onChanged, 'bitcoin', releaseDigital),
    );
    await act(async () => {
      result.current.confirmForm.setValue('reason', 'Seen in Bitkit');
      await result.current.submitConfirm();
    });

    expect(CommerceController.confirmBitcoinPayment).toHaveBeenCalledTimes(1);
    expect(CommerceController.confirmBitcoinPayment).toHaveBeenCalledWith('order-1', 'Seen in Bitkit', releaseDigital);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
