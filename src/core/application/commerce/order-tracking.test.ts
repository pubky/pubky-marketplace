import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { CommerceOrderTrackingApplication } from './order-tracking';

vi.mock('@/services/marketplace/marketplace', () => ({
  MarketplaceGatewayService: { execute: vi.fn() },
}));

const ACTOR = 's'.repeat(52);
const ORDER_ID = '018f47d2-6a27-7c23-a62f-000000000720';

beforeEach(() => {
  vi.mocked(MarketplaceGatewayService.execute)
    .mockReset()
    .mockResolvedValue({ ok: true, result: { kind: 'order' } } as never);
});

describe('CommerceOrderTrackingApplication.commitUpdateTracking', () => {
  it('sends fulfillment.update_tracking on the order aggregate at the loaded revision', async () => {
    const response = await CommerceOrderTrackingApplication.commitUpdateTracking(ACTOR, {
      orderId: ORDER_ID,
      expectedRevision: 3,
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    });

    expect(response.ok).toBe(true);
    expect(MarketplaceGatewayService.execute).toHaveBeenCalledTimes(1);
    const [actor, command] = vi.mocked(MarketplaceGatewayService.execute).mock.calls[0];
    expect(actor).toBe(ACTOR);
    expect(command).toMatchObject({
      version: 1,
      aggregateId: `order:${ORDER_ID}`,
      expectedRevision: 3,
      kind: 'fulfillment.update_tracking',
      payload: { orderId: ORDER_ID, carrier: 'UPS', trackingNumber: '1Z999AA10123456784' },
    });
  });

  it('returns a service refusal untouched', async () => {
    const refusal = { ok: false, error: { code: 'INVALID_STATE', message: 'Not shipped.' } };
    vi.mocked(MarketplaceGatewayService.execute).mockResolvedValue(refusal as never);

    await expect(
      CommerceOrderTrackingApplication.commitUpdateTracking(ACTOR, {
        orderId: ORDER_ID,
        expectedRevision: 3,
        carrier: 'UPS',
        trackingNumber: 'X-1234',
      }),
    ).resolves.toBe(refusal);
  });

  it('refuses an empty tracking number before anything is sent', async () => {
    await expect(
      CommerceOrderTrackingApplication.commitUpdateTracking(ACTOR, {
        orderId: ORDER_ID,
        expectedRevision: 3,
        carrier: 'UPS',
        trackingNumber: '',
      }),
    ).rejects.toThrow();
    expect(MarketplaceGatewayService.execute).not.toHaveBeenCalled();
  });
});
