import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceController } from './commerce';

const SELLER = 's'.repeat(52);

describe('CommerceController attestor reads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the attestor key windows before it reads the reviews they scope', async () => {
    const order: string[] = [];
    vi.spyOn(CommerceAttestorApplication, 'loadKeyWindows').mockImplementation(async () => {
      order.push('windows');
    });
    vi.spyOn(CommerceApplication, 'fetchSellerReviews').mockImplementation(async () => {
      order.push('reviews');
      return { status: 'unavailable' };
    });

    await CommerceController.fetchSellerReviews(SELLER);

    expect(order).toEqual(['windows', 'reviews']);
  });

  it('forwards the orders to ask about and answers the application map', async () => {
    const outcomes = new Map([['a:b', [{ kind: 'refunded' as const, on: '2026-10-14' }]]]);
    const read = vi.spyOn(CommerceAttestorApplication, 'fetchOutcomes').mockResolvedValue(outcomes);
    const orders = [{ attestorId: 'a', orderRef: 'b' }];

    await expect(CommerceController.fetchReviewOutcomes(orders)).resolves.toBe(outcomes);
    expect(read).toHaveBeenCalledWith(orders);
  });
});
