import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceOrderTrackingApplication } from '@/application/commerce/order-tracking';
import { CommerceOrderTrackingController } from './order-tracking';

vi.mock('@/application/commerce/order-tracking', () => ({
  CommerceOrderTrackingApplication: { commitUpdateTracking: vi.fn() },
}));

const PUBKY = 's'.repeat(52);
const ORDER_ID = '018f47d2-6a27-7c23-a62f-000000000720';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: { getState: () => ({ selectCurrentUserPubky: () => 's'.repeat(52) }) },
}));

beforeEach(() => {
  vi.mocked(CommerceOrderTrackingApplication.commitUpdateTracking)
    .mockReset()
    .mockResolvedValue({ ok: true } as never);
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
});
