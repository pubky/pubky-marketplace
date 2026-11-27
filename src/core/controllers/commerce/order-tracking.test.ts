import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceOrderTrackingApplication } from '@/application/commerce/order-tracking';
import { setStoreSeller } from '@/test-utils/store-mode';
import { CommerceOrderTrackingController } from './order-tracking';

vi.mock('@/application/commerce/order-tracking', () => ({
  CommerceOrderTrackingApplication: { commitUpdateTracking: vi.fn() },
}));

const PUBKY = 's'.repeat(52);
const ORDER_ID = '018f47d2-6a27-7c23-a62f-000000000720';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: {
    getState: () => ({ currentUserPubky: 's'.repeat(52), selectCurrentUserPubky: () => 's'.repeat(52) }),
  },
}));

beforeEach(() => {
  vi.mocked(CommerceOrderTrackingApplication.commitUpdateTracking)
    .mockReset()
    .mockResolvedValue({ ok: true } as never);
});

afterEach(() => {
  setStoreSeller(undefined);
});

describe('CommerceOrderTrackingController.commitUpdateOrderTracking', () => {
  it('passes the current user and trimmed values to the application', async () => {
    await CommerceOrderTrackingController.commitUpdateOrderTracking(ORDER_ID, 4, ' UPS ', ' 1Z999 ');

    expect(CommerceOrderTrackingApplication.commitUpdateTracking).toHaveBeenCalledWith(PUBKY, {
      orderId: ORDER_ID,
      expectedRevision: 4,
      carrier: 'UPS',
      trackingNumber: '1Z999',
    });
  });

  it.each([
    ['a missing revision', ORDER_ID, undefined, 'UPS', 'X-1'],
    ['a blank carrier', ORDER_ID, 1, ' ', 'X-1'],
    ['a blank tracking number', ORDER_ID, 1, 'UPS', ''],
  ])('refuses %s', async (_name, orderId, revision, carrier, number) => {
    await expect(
      CommerceOrderTrackingController.commitUpdateOrderTracking(orderId, revision, carrier, number),
    ).rejects.toThrow();
    expect(CommerceOrderTrackingApplication.commitUpdateTracking).not.toHaveBeenCalled();
  });

  it('refuses in a store the current user does not sell in, and runs for the store seller', async () => {
    setStoreSeller('y'.repeat(52));
    await expect(
      CommerceOrderTrackingController.commitUpdateOrderTracking(ORDER_ID, 4, 'UPS', '1Z999'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', operation: 'assertCanSellHere' });
    expect(CommerceOrderTrackingApplication.commitUpdateTracking).not.toHaveBeenCalled();

    setStoreSeller(PUBKY);
    await CommerceOrderTrackingController.commitUpdateOrderTracking(ORDER_ID, 4, 'UPS', '1Z999');
    expect(CommerceOrderTrackingApplication.commitUpdateTracking).toHaveBeenCalledTimes(1);
  });
});
