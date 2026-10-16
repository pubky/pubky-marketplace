import { describe, expect, it } from 'vitest';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { marketplaceOrderSchema } from './marketplace-projections';

const shipment = { carrier: 'Other', state: 'shipped', shippedAt: '2026-08-14T10:00:00.000Z', deliveredAt: null };

function parseShipment(value: Record<string, unknown>) {
  const parsed = marketplaceOrderSchema.parse({ ...createOrderFixture('shipped'), shipment: value });
  return parsed.shipment;
}

describe('marketplace order projection — shipment tracking may be absent', () => {
  it('reads a shipment with no tracking number as an empty one', () => {
    expect(parseShipment(shipment)?.trackingNumber).toBe('');
    expect(parseShipment({ ...shipment, trackingNumber: null })?.trackingNumber).toBe('');
  });

  it('keeps a tracking number the service sends', () => {
    expect(parseShipment({ ...shipment, carrier: 'UPS', trackingNumber: '1Z999AA10123456784' })).toMatchObject({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    });
  });
});
