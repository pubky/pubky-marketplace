import type { MarketplaceOrder, MarketplacePayment } from '@/services/marketplace/marketplace';
import { createOrderFixture, createPaymentFixture } from './orders';
import { USDT_ORDER_FIELDS } from './usdt-orders';

/**
 * Parsed single-bind Paykit orders (`payment_method: "paykit"`): the buyer
 * picks Bitcoin or USDT in Bitkit, so `paymentAsset` is null until the service
 * observes a payment and then names the rail actually paid.
 */
export type PaykitOrderPhase = 'unpaid' | 'paid-bitcoin' | 'paid-usdt';

export const PAYKIT_UNPAID_ORDER_FIELDS = {
  paymentMethod: 'paykit',
  paymentAsset: null,
  acceptedAssets: ['BTC', 'USDT'],
  paykitRequestState: 'pending',
  paykitDeliveryState: 'delivered',
} as const satisfies Partial<MarketplaceOrder>;

export function createPaykitOrderFixture(
  phase: PaykitOrderPhase,
  overrides: Partial<MarketplaceOrder> = {},
): { order: MarketplaceOrder; payment: MarketplacePayment } {
  const unpaid = phase === 'unpaid';
  const payment = createPaymentFixture(unpaid ? 'awaiting_entitlement' : 'confirmed', {
    adapter: 'paykit',
    locksBundleId: undefined,
  });
  const paidFields =
    phase === 'paid-usdt'
      ? { ...USDT_ORDER_FIELDS, paymentMethod: 'paykit' as const, acceptedAssets: ['BTC', 'USDT'] as const }
      : { paymentMethod: 'paykit' as const, paymentAsset: 'BTC' as const, acceptedAssets: ['BTC', 'USDT'] as const };
  const order = createOrderFixture(unpaid ? 'pending_payment' : 'paid', {
    paymentId: payment.id,
    ...(unpaid ? PAYKIT_UNPAID_ORDER_FIELDS : paidFields),
    ...(unpaid ? { holdExpiresAt: '2026-08-20T21:15:00.000Z' } : {}),
    ...(phase === 'paid-usdt' ? { paymentFinality: 'pending' as const } : {}),
    ...overrides,
  } as Partial<MarketplaceOrder>);
  return { order, payment };
}
