import { describe, expect, it } from 'vitest';
import {
  buyerShipmentTracking,
  canEditOrderTracking,
  hasTrackingNumber,
  resolveTrackingCarrierName,
  trackingFormValuesFor,
} from './order-tracking';

const shipment = (carrier: string, trackingNumber: string, state = 'shipped') => ({ carrier, trackingNumber, state });

describe('canEditOrderTracking', () => {
  const shipped = { state: 'shipped', fulfillment: 'shipping', shipment: shipment('UPS', '') };

  it('allows the seller of a shipped, undelivered shipping order', () => {
    expect(canEditOrderTracking(shipped, false)).toBe(true);
  });

  it('refuses the buyer, other states, a delivered shipment and non-shipping orders', () => {
    expect(canEditOrderTracking(shipped, true)).toBe(false);
    expect(canEditOrderTracking({ ...shipped, state: 'paid' }, false)).toBe(false);
    expect(canEditOrderTracking({ ...shipped, shipment: shipment('UPS', 'X', 'delivered') }, false)).toBe(false);
    expect(canEditOrderTracking({ ...shipped, shipment: null }, false)).toBe(false);
    expect(canEditOrderTracking({ ...shipped, fulfillment: 'pickup' }, false)).toBe(false);
    expect(canEditOrderTracking({ ...shipped, fulfillment: 'digital' }, false)).toBe(false);
  });
});

describe('resolveTrackingCarrierName', () => {
  it('writes the registry name for a curated carrier', () => {
    expect(resolveTrackingCarrierName('royal-mail', '')).toBe('Royal Mail');
  });

  it('keeps the seller text for Other and falls back to Other when it is blank', () => {
    expect(resolveTrackingCarrierName('other', ' Correio da Aldeia ')).toBe('Correio da Aldeia');
    expect(resolveTrackingCarrierName('other', '  ')).toBe('Other');
  });
});

describe('trackingFormValuesFor', () => {
  it('starts from the carrier and number the order shows', () => {
    expect(trackingFormValuesFor(shipment('fed ex', 'ABC123'))).toEqual({
      carrierChoice: 'fedex',
      carrier: '',
      trackingNumber: 'ABC123',
    });
    expect(trackingFormValuesFor(shipment('Correio da Aldeia', ''))).toEqual({
      carrierChoice: 'other',
      carrier: 'Correio da Aldeia',
      trackingNumber: '',
    });
  });

  it('treats the Other default as no name and an absent shipment as blank', () => {
    expect(trackingFormValuesFor(shipment('Other', '')).carrier).toBe('');
    expect(trackingFormValuesFor(null)).toEqual({ carrierChoice: '', carrier: '', trackingNumber: '' });
  });
});

describe('buyerShipmentTracking', () => {
  it('says shipped with no tracking yet when there is no number', () => {
    expect(hasTrackingNumber(shipment('Other', '  '))).toBe(false);
    expect(buyerShipmentTracking(shipment('Other', ''))).toEqual({
      kind: 'pending',
      label: 'Shipped, no tracking yet',
    });
  });

  it('says delivered, no tracking once a shipment without a number is delivered', () => {
    expect(buyerShipmentTracking(shipment('Other', '', 'delivered'))).toEqual({
      kind: 'pending',
      label: 'Delivered, no tracking',
    });
  });

  it('links a known carrier and leaves an unknown one as plain text', () => {
    expect(buyerShipmentTracking(shipment('UPS', '1Z999AA10123456784'))).toEqual({
      kind: 'tracked',
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    });
    expect(buyerShipmentTracking(shipment('Correio da Aldeia', 'CA-0001'))).toMatchObject({
      kind: 'tracked',
      url: null,
    });
  });
});
