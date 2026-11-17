import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER } from '@/test/fixtures/commerce/orders';
import { CommerceController } from './commerce';

describe('CommerceController own reviews', () => {
  beforeEach(() => {
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
  });

  afterEach(() => {
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
  });

  it('removes a review through the application for the signed-in user', async () => {
    const remove = vi.spyOn(CommerceApplication, 'commitDeleteOwnReview').mockResolvedValue('removed');

    await expect(CommerceController.commitDeleteOwnMarketplaceReview('order-1')).resolves.toBe('removed');
    expect(remove).toHaveBeenCalledWith(ORDER_FIXTURE_BUYER, 'order-1');
  });

  it.each([undefined, null, '', 7])('refuses to remove a review without an order id (%s)', async (orderId) => {
    const remove = vi.spyOn(CommerceApplication, 'commitDeleteOwnReview');

    await expect(CommerceController.commitDeleteOwnMarketplaceReview(orderId)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refreshes and resumes through the application for the signed-in user', async () => {
    const orders = [createOrderFixture('completed')];
    const refresh = vi.spyOn(CommerceApplication, 'refreshOwnReviews').mockResolvedValue(2);
    const resume = vi.spyOn(CommerceApplication, 'resumeOwnReviewRemovals').mockResolvedValue(1);

    await expect(CommerceController.refreshOwnMarketplaceReviews(orders)).resolves.toBe(2);
    await expect(CommerceController.resumeOwnReviewRemovals()).resolves.toBe(1);
    expect(refresh).toHaveBeenCalledWith(ORDER_FIXTURE_BUYER, orders);
    expect(resume).toHaveBeenCalledWith(ORDER_FIXTURE_BUYER);
  });
});
