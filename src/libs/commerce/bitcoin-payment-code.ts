import type { PaykitServerApi } from '@/libs/runtime-config/runtime-config.schema';
import { formatCommerceMoney } from './format';
import { mayPayInBitcoin, observedPaymentRail } from './paykit-rail';
import type { PaymentMethodKind } from './payment-methods';
import { formatBitcoinAmount, hasSameAsset, isBitcoinAsset, MAX_BITCOIN_BASE_UNITS } from './pricing';
import type { CommerceMoney } from './transaction-contracts';
import { usdtRefundCap, usdtRefundCapMinor } from './usdt-refund';

/**
 * On the fork Paykit server a Bitcoin payment adds a random 1–999 sat amount
 * so the seller's wallet can match that payment. The checkout total is the
 * list price. The exact figure exists only after the order is placed. Upstream
 * paykit-server (`paykitServerApi=upstream`) allocates a fresh address per
 * request and never adds an amount: the service requires the prepared total to
 * equal the price, so the request is for exactly the price.
 */
export const BITCOIN_PAYMENT_CODE_MIN_SATS = 1;

export function bitcoinPaymentCodeCheckoutNote(api: PaykitServerApi): string | null {
  return api === 'fork' ? 'Bitcoin payments include an extra ₿1–₿999 to help the seller match your payment.' : null;
}

export const BITCOIN_PAYMENT_CODE_EXPLANATION = 'The payment code helps the seller match your payment.';

const SATOSHI: CommerceMoney = { amountMinor: 0, currency: 'SAT', exponent: 0 };

export type BitcoinPaymentOrder = {
  paymentMethod?: PaymentMethodKind | null;
  paymentAsset?: string | null;
  paymentAmountMinor?: number | null;
  subtotal: CommerceMoney;
  shipping: CommerceMoney;
  total?: CommerceMoney;
  merchandiseTotal?: CommerceMoney | null;
  bitcoinPayable?: CommerceMoney | null;
  paykitTotalSats?: number | null;
  bitcoinQuote?: { quotedSats: number | null } | null;
};

export type BitcoinPaymentBreakdown = {
  items: CommerceMoney;
  shipping: CommerceMoney;
  paymentCode: CommerceMoney;
  payable: CommerceMoney;
};

/** BTC at exponent 8 and SAT at exponent 0 are both integer satoshis. */
export function satoshiCount(money: CommerceMoney | null | undefined): number | null {
  if (!money) return null;
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0) return null;
  if (money.amountMinor > MAX_BITCOIN_BASE_UNITS) return null;
  if (isBitcoinAsset(money)) return money.amountMinor;
  if (money.currency === 'SAT' && money.exponent === 0) return money.amountMinor;
  return null;
}

export function formatBitcoinAwareMoney(money: CommerceMoney): string {
  const sats = satoshiCount(money);
  return sats === null ? formatCommerceMoney(money) : formatBitcoinAmount(sats);
}

export type OrderAmountEntry = {
  amountMinor: number;
  exponent: number;
  unitLabel: string;
};

/**
 * The amount a refund or return form records. A Bitcoin order is integer
 * satoshis (the payable, including the payment code). Any other rail keeps
 * the order total's own currency and exponent.
 */
export function orderAmountEntry(order: BitcoinPaymentOrder & { total: CommerceMoney }): OrderAmountEntry {
  const usdtCap = usdtRefundCap(order);
  if (usdtCap) return { amountMinor: usdtCap.amountMinor, exponent: usdtCap.exponent, unitLabel: 'USDT' };
  const breakdown = bitcoinPaymentBreakdown(order);
  if (breakdown) {
    const sats = satoshiCount(breakdown.payable);
    if (sats !== null) return { amountMinor: sats, exponent: 0, unitLabel: '₿' };
  }
  if (observedPaymentRail(order) === 'bitcoin') {
    const sats = satoshiCount(order.total);
    if (sats !== null) return { amountMinor: sats, exponent: 0, unitLabel: '₿' };
  }
  return { amountMinor: order.total.amountMinor, exponent: order.total.exponent, unitLabel: order.total.currency };
}

/**
 * The amount a refund form records, at most. A USDT order is capped at the
 * USDT it received rather than its total, so a seller can return exactly what
 * an underpaid or overpaid transfer carried. A return request stays within the
 * total (`orderAmountEntry`): the service caps it there.
 */
export function orderRefundEntry(order: BitcoinPaymentOrder & { total: CommerceMoney }): OrderAmountEntry {
  const entry = orderAmountEntry(order);
  const received = usdtRefundCapMinor(order);
  return received === null ? entry : { ...entry, amountMinor: received };
}

export function formatBitcoinAmountBreakdown(breakdown: BitcoinPaymentBreakdown): string {
  return `Items ${formatBitcoinAwareMoney(breakdown.items)} · Shipping ${formatBitcoinAwareMoney(breakdown.shipping)} · Payment code ${formatBitcoinAwareMoney(breakdown.paymentCode)} = Total ${formatBitcoinAwareMoney(breakdown.payable)}`;
}

function money(amountMinor: number, asset: Pick<CommerceMoney, 'currency' | 'exponent'>): CommerceMoney {
  return { amountMinor, currency: asset.currency, exponent: asset.exponent };
}

function payableSats(order: BitcoinPaymentOrder): number | null {
  const fromPayable = satoshiCount(order.bitcoinPayable);
  if (fromPayable !== null && fromPayable > 0) return fromPayable;
  const raw = order.paykitTotalSats;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 && raw <= MAX_BITCOIN_BASE_UNITS) return raw;
  return null;
}

/**
 * Items + shipping + payment code = the exact bitcoin amount, once the
 * service has drawn the code. Returns null before that draw, for any other
 * rail, and when the parts would not add up.
 */
export function bitcoinPaymentBreakdown(order: BitcoinPaymentOrder): BitcoinPaymentBreakdown | null {
  if (!mayPayInBitcoin(order)) return null;
  const payable = payableSats(order);
  if (payable === null) return null;

  const itemsSats = satoshiCount(order.subtotal);
  const shippingSats = satoshiCount(order.shipping);
  if (itemsSats !== null && shippingSats !== null && hasSameAsset(order.subtotal, order.shipping)) {
    const merchandiseFromParts = itemsSats + shippingSats;
    const merchandiseFromField = satoshiCount(order.merchandiseTotal);
    if (merchandiseFromField !== null && merchandiseFromField !== merchandiseFromParts) return null;
    const code = payable - merchandiseFromParts;
    if (!Number.isSafeInteger(code) || code < BITCOIN_PAYMENT_CODE_MIN_SATS) return null;
    return {
      items: order.subtotal,
      shipping: order.shipping,
      paymentCode: money(code, order.subtotal),
      payable: money(payable, order.subtotal),
    };
  }

  const quoted = order.bitcoinQuote?.quotedSats;
  if (typeof quoted !== 'number' || !Number.isSafeInteger(quoted) || quoted <= 0) return null;
  if (!hasSameAsset(order.subtotal, order.shipping)) return null;
  const code = payable - quoted;
  if (!Number.isSafeInteger(code) || code < BITCOIN_PAYMENT_CODE_MIN_SATS) return null;
  return {
    items: order.subtotal,
    shipping: order.shipping,
    paymentCode: money(code, SATOSHI),
    payable: money(payable, SATOSHI),
  };
}
