import {
  buildCarrierTrackingUrl,
  getCarrierById,
  OTHER_CARRIER_ID,
  resolveCarrierByName,
} from '@/libs/commerce/carriers';

/** The carrier a shipment is recorded with when the seller does not know it. */
export const UNKNOWN_CARRIER_NAME = 'Other';

export const ORDER_TRACKING_COPY = {
  shippedNoTracking: 'Shipped, no tracking yet',
  add: 'Add tracking',
  edit: 'Edit tracking',
  title: 'Tracking',
  saved: 'Tracking saved',
  failed: 'Could not save tracking.',
  changed: 'This order changed since you loaded it. The latest state was reloaded, so check it and try again.',
} as const;

type ShipmentLike = { carrier: string; trackingNumber: string; state: string };

type TrackableOrder = {
  state: string;
  fulfillment?: string;
  shipment?: ShipmentLike | null;
};

export function hasTrackingNumber(shipment: Pick<ShipmentLike, 'trackingNumber'> | null | undefined): boolean {
  return Boolean(shipment?.trackingNumber.trim());
}

/** The service accepts a tracking change only on a shipped, undelivered shipping order, and only from the seller. */
export function canEditOrderTracking(order: TrackableOrder, isBuyer: boolean): boolean {
  return (
    !isBuyer &&
    order.state === 'shipped' &&
    order.shipment?.state === 'shipped' &&
    (order.fulfillment === undefined || order.fulfillment === 'shipping')
  );
}

/** The carrier written to the command: the registry name, the seller's own text, or `Other` when unknown. */
export function resolveTrackingCarrierName(carrierChoice: string, carrierText: string): string {
  if (carrierChoice === OTHER_CARRIER_ID) return carrierText.trim() || UNKNOWN_CARRIER_NAME;
  return getCarrierById(carrierChoice)?.name ?? (carrierText.trim() || UNKNOWN_CARRIER_NAME);
}

/** Form values for a shipment already on the order, so editing starts from what the buyer sees. */
export function trackingFormValuesFor(shipment: ShipmentLike | null | undefined): {
  carrierChoice: string;
  carrier: string;
  trackingNumber: string;
} {
  const carrierName = shipment?.carrier.trim() ?? '';
  const known = carrierName ? resolveCarrierByName(carrierName) : null;
  if (known) return { carrierChoice: known.id, carrier: '', trackingNumber: shipment?.trackingNumber ?? '' };
  return {
    carrierChoice: OTHER_CARRIER_ID,
    carrier: carrierName && carrierName !== UNKNOWN_CARRIER_NAME ? carrierName : '',
    trackingNumber: shipment?.trackingNumber ?? '',
  };
}

export type BuyerShipmentTracking =
  | { kind: 'pending'; label: string }
  | { kind: 'tracked'; carrier: string; trackingNumber: string; url: string | null };

/** What the buyer sees on a shipment: no number yet, or the number with a link when the carrier is known. */
export function buyerShipmentTracking(shipment: ShipmentLike): BuyerShipmentTracking {
  if (!hasTrackingNumber(shipment)) return { kind: 'pending', label: ORDER_TRACKING_COPY.shippedNoTracking };
  return {
    kind: 'tracked',
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    url: buildCarrierTrackingUrl(shipment.carrier, shipment.trackingNumber),
  };
}
