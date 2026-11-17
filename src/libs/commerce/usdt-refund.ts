import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { formatUsdt, USDT_EXPONENT } from '@/libs/commerce/payment-options';

/**
 * USDT refund domain (docs/ecommerce/usdt-payments.md, plan §2.6). The
 * marketplace never holds funds, so a refund is two human steps the Shop only
 * records: the buyer confirms an Arbitrum One USDT address on the order page,
 * and the seller sends the refund from Bitkit and records the Arbitrum
 * transaction hash. Nothing here verifies a transfer on-chain; every string
 * says "recorded", never "verified" or "confirmed on Arbitrum".
 *
 * Wire contract with the service's S6 slice (pinned here and in
 * `src/test/fixtures/commerce/usdt-refund.wire.ts`):
 *
 * - Command `refund.confirm_destination`, buyer only, payload
 *   `{ order_id, address }` (camelCased in the Shop). The buyer may replace the
 *   address until a refund is recorded; afterwards the service refuses with
 *   `INVALID_STATE`.
 * - Participant order projection `refund_destination`:
 *   `{ address, network: 'arbitrum-one', asset: 'USDT', source, confirmed_at }`,
 *   null or absent until confirmed. `source` is `buyer_entered` today and is
 *   only ever displayed, never branched on, so a later source never hides an
 *   address.
 * - On a USDT order `refund.record_external` carries the Arbitrum transaction
 *   hash (`0x` + 64 hex, lowercase on the wire) as `transaction_id`, and the
 *   service refuses it without a confirmed destination.
 * - Closed refusal reasons: `refund_destination_required`,
 *   `invalid_refund_destination`, `invalid_refund_reference`.
 */

export const REFUND_DESTINATION_ASSET = 'USDT';
export const REFUND_DESTINATION_NETWORK = 'arbitrum-one';
export const CONFIRM_REFUND_DESTINATION_KIND = 'refund.confirm_destination';

export const ARBITRUM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const ARBITRUM_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const refundDestinationSchema = z.object({
  address: z.string().regex(ARBITRUM_ADDRESS_PATTERN),
  network: z.literal(REFUND_DESTINATION_NETWORK),
  asset: z.literal(REFUND_DESTINATION_ASSET),
  source: z.string().min(1),
  confirmedAt: z.string().min(1),
});

export type RefundDestination = z.infer<typeof refundDestinationSchema>;

/**
 * Order projection fields for the refund address. Tolerant like the other
 * display-only payment fields: a value the Shop cannot read is dropped for
 * that order and never fails the order parse.
 *
 * `paymentAddress` is the buyer's own paying address when the service knows
 * it. The S6 slice does not send it (rc10 status exposes no payer address,
 * plan §2.6 / N2), so the "send it back to the address I paid from" choice
 * stays hidden until a service starts sending it.
 */
export const refundDestinationFieldsShape = {
  refundDestination: refundDestinationSchema.nullish().catch(undefined),
  paymentAddress: z.string().regex(ARBITRUM_ADDRESS_PATTERN).nullish().catch(undefined),
};

function isEip55Checksummed(address: string): boolean {
  const body = address.slice(2);
  const hash = bytesToHex(keccak_256(utf8ToBytes(body.toLowerCase())));
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (!/[a-f]/i.test(character)) continue;
    const expected = Number.parseInt(hash[index], 16) >= 8 ? character.toUpperCase() : character.toLowerCase();
    if (character !== expected) return false;
  }
  return true;
}

/**
 * `0x` + 40 hex. A mixed-case address must carry a correct EIP-55 checksum
 * (a typo is caught before it can cost the buyer their refund); all-lowercase
 * and all-uppercase addresses carry no checksum and are accepted as typed.
 */
export function isValidArbitrumAddress(value: string): boolean {
  if (!ARBITRUM_ADDRESS_PATTERN.test(value)) return false;
  const body = value.slice(2);
  const isMixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  return !isMixedCase || isEip55Checksummed(value);
}

export function isArbitrumTxHash(value: string): boolean {
  return ARBITRUM_TX_HASH_PATTERN.test(value);
}

/** The service stores and compares the lowercase form of a transaction hash. */
export function normalizeArbitrumTxHash(value: string): string {
  return value.trim().toLowerCase();
}

export function sameArbitrumAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

export type UsdtRefundOrder = {
  state: string;
  total: { amountMinor: number; currency: string; exponent: number };
  paymentAsset?: string | null;
  paymentAmountMinor?: number | null;
  receiptId?: string | null;
  refundDestination?: RefundDestination | null;
  paymentAddress?: string | null;
  returnRequest?: { state: string; requestedAmountMinor: number } | null;
  externalRefund?: {
    amountMinor: number;
    transactionId: string;
    /** USDT millionths Arbitrum shows reaching the refund address; absent when the service didn't check. */
    receivedUnits?: number | null;
  } | null;
};

/**
 * The refund-address surfaces belong to orders the service projects as paid
 * in USDT. They are never gated by the new-offer flag: a USDT order that
 * exists must be refundable after the flag flips (plan §3, "Off never strands
 * money"). Bitcoin and PayPal orders never carry `paymentAsset`.
 */
export function isUsdtRefundOrder(order: { paymentAsset?: string | null }): boolean {
  return order.paymentAsset === REFUND_DESTINATION_ASSET;
}

/** States that are only reachable once the buyer's money has settled or is under review. */
const SETTLED_STATES = new Set([
  'paid',
  'processing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'completed',
  'cancel_requested',
  'return_requested',
  'return_approved',
  'return_received',
  'refunded_external',
  'refunded_partial',
]);

/** States where a refund is plainly on its way, so the address is the next step. */
const REFUND_DUE_STATES = new Set([
  'cancel_requested',
  'cancelled',
  'return_requested',
  'return_approved',
  'return_received',
]);

/**
 * `cancelled` and `closed` can also mean "never paid"; only a paid order has a
 * receipt, or a review that ended `abandoned`: that money was received and is
 * still owed back.
 */
function hasSettledPayment(order: UsdtRefundOrder, paymentInReview: boolean, reviewAbandoned: boolean): boolean {
  if (SETTLED_STATES.has(order.state)) return true;
  if (order.state === 'cancelled' || order.state === 'closed') return !!order.receiptId || reviewAbandoned;
  return order.state === 'pending_payment' && paymentInReview;
}

export type UsdtRefundSurface =
  | { kind: 'hidden' }
  | {
      kind: 'buyer';
      /** `recorded` once the seller recorded the refund; the address can no longer change. */
      phase: 'needed' | 'confirmed' | 'recorded';
      refundDue: boolean;
    }
  | { kind: 'seller'; phase: 'waiting' | 'confirmed' | 'recorded' };

/**
 * What the refund-address panel shows for a viewer. `paymentInReview` is the
 * payment projection's `manual_review` state: late or mismatched money the
 * seller may have to return (plan §2.6, flow step 1). `reviewAbandoned` is a
 * review that ended `abandoned` (by the seller, or after seven days without
 * them): the order is cancelled, and the money is still the buyer's.
 */
export function usdtRefundSurface(
  order: UsdtRefundOrder,
  isBuyer: boolean,
  paymentInReview: boolean,
  reviewAbandoned = false,
): UsdtRefundSurface {
  if (!isUsdtRefundOrder(order) || !hasSettledPayment(order, paymentInReview, reviewAbandoned)) {
    return { kind: 'hidden' };
  }
  const recorded = !!order.externalRefund;
  const refundDue = REFUND_DUE_STATES.has(order.state) || paymentInReview || reviewAbandoned;
  if (isBuyer) {
    return {
      kind: 'buyer',
      phase: recorded ? 'recorded' : order.refundDestination ? 'confirmed' : 'needed',
      refundDue,
    };
  }
  if (!order.refundDestination && !refundDue && !recorded) return { kind: 'hidden' };
  return { kind: 'seller', phase: recorded ? 'recorded' : order.refundDestination ? 'confirmed' : 'waiting' };
}

/**
 * Order totals for USDT are USD at exact parity: one cent is 10,000 millionths
 * of a USDT (plan §2.2). Any other currency has no parity amount.
 */
export function usdtParityMillionths(money: {
  amountMinor: number;
  currency: string;
  exponent: number;
}): number | null {
  if (money.currency !== 'USD' || money.exponent !== 2) return null;
  const millionths = money.amountMinor * 10 ** (USDT_EXPONENT - money.exponent);
  return Number.isSafeInteger(millionths) && millionths >= 0 ? millionths : null;
}

/**
 * A USDT order priced in anything but USD/2 (a Bitcoin or satoshi price: Paykit
 * fixes the rate at prepare) records its refund in USDT0 millionths, capped at
 * the amount paid (`external_refund.amount_minor`). A USD order keeps cents at
 * parity. Null when the order's own USDT amount is unknown.
 */
export function usdtRefundCap(
  order: Pick<UsdtRefundOrder, 'total' | 'paymentAsset' | 'paymentAmountMinor'>,
): { amountMinor: number; currency: 'USDT'; exponent: number } | null {
  if (!isUsdtRefundOrder(order)) return null;
  if (usdtParityMillionths(order.total) !== null) return null;
  const paid = order.paymentAmountMinor;
  if (typeof paid !== 'number' || !Number.isSafeInteger(paid) || paid < 0) return null;
  return { amountMinor: paid, currency: 'USDT', exponent: USDT_EXPONENT };
}

/** The USDT figure for an amount in the order's refund units: parity cents, or millionths when recorded in USDT. */
export function formatUsdtRefundAmount(
  order: Pick<UsdtRefundOrder, 'total' | 'paymentAsset' | 'paymentAmountMinor'>,
  amountMinor: number,
  options: { grouped?: boolean } = {},
): string | null {
  if (usdtRefundCap(order)) return Number.isSafeInteger(amountMinor) ? formatUsdt(amountMinor, options) : null;
  return formatUsdtParity({ ...order.total, amountMinor }, options);
}

export function formatUsdtParity(
  money: { amountMinor: number; currency: string; exponent: number },
  options: { grouped?: boolean } = {},
): string | null {
  const millionths = usdtParityMillionths(money);
  return millionths === null ? null : formatUsdt(millionths, options);
}

const USDT_MILLIONTHS_PER_CENT = 10 ** (USDT_EXPONENT - 2);

/**
 * The most a USDT refund of the order may record, in its refund units: the USDT
 * it received. `paymentAmountMinor` is what the observed transfer carried, a
 * transfer for another amount than quoted included, so an underpaid order is
 * capped below its total and an overpaid one may refund its excess. A USD order
 * records cents, so an amount between two cents caps at the lower one, as the
 * service's `refund_cap_minor` does. Null for any other order; the total when
 * the order carries no received amount.
 */
export function usdtRefundCapMinor(
  order: Pick<UsdtRefundOrder, 'total' | 'paymentAsset' | 'paymentAmountMinor'>,
): number | null {
  if (!isUsdtRefundOrder(order)) return null;
  const cap = usdtRefundCap(order);
  if (cap) return cap.amountMinor;
  const received = order.paymentAmountMinor;
  if (usdtParityMillionths(order.total) === null || typeof received !== 'number' || !Number.isSafeInteger(received)) {
    return order.total.amountMinor;
  }
  return received >= 0 ? Math.floor(received / USDT_MILLIONTHS_PER_CENT) : order.total.amountMinor;
}

/** The amount the seller is asked to send: the requested return amount, else the whole amount received. */
export function usdtRefundDueMoney(order: UsdtRefundOrder): UsdtRefundOrder['total'] {
  // Recorded in USDT, a partial request in order units has no exact USDT figure, so the whole amount paid is due.
  const cap = usdtRefundCap(order);
  if (cap) return cap;
  const received = usdtRefundCapMinor(order) ?? order.total.amountMinor;
  const requested = order.returnRequest && order.returnRequest.state !== 'refunded' ? order.returnRequest : null;
  return { ...order.total, amountMinor: requested ? Math.min(requested.requestedAmountMinor, received) : received };
}

export const USDT_REFUND_COPY = {
  buyerTitle: 'Refund address',
  buyerNeededDue: 'Confirm your refund address so the seller can refund you. They send it there and record it here.',
  buyerNeeded:
    'If you are ever refunded, the seller sends it to the address you confirm here. You can confirm it now or when a refund is due.',
  buyerConfirmed: 'Your refund address is confirmed. The seller sends the refund there and records it on this order.',
  buyerRecorded: 'Your refund address is locked in because the seller has recorded a refund.',
  sellerTitle: 'Buyer refund address',
  sellerWaiting: "Ask the buyer to confirm a refund address first. It's on their order page.",
  sellerAwaitingBuyer: "Waiting for the buyer's refund address. You can record the refund once they confirm it.",
  sellerConfirmed: 'Send this refund from Bitkit, then record the Arbitrum transaction hash with Record refund.',
  sellerConfirmedInReview:
    'Send this refund from Bitkit, then record the Arbitrum transaction hash when you resolve this payment as refunded.',
  sellerRecorded: 'You recorded a refund to this address. The Shop has not checked it on Arbitrum.',
  sellerRecordedChecked: 'You recorded a refund to this address. The Shop checked it on Arbitrum.',
  networkWarning:
    'If this is an exchange deposit address, check that the exchange accepts USDT on Arbitrum One. Funds sent on the wrong network can be lost.',
  networkConfirmation: 'This address accepts USDT on Arbitrum One',
  networkConfirmationRequired: 'Confirm that this address accepts USDT on Arbitrum One.',
  addressRequired: 'Enter an Arbitrum One address.',
  addressInvalid: "That isn't a valid Arbitrum address. Check it and try again.",
  anotherAddressChoice: 'Send it to another Arbitrum One USDT address',
  originalAddressChoice: 'Send it back to the address I paid from',
  paykitAddressChoice: 'Send it to my Paykit USDT address',
  recordedBySeller: 'Recorded by the seller',
  notChecked: "The Shop hasn't checked it on Arbitrum.",
  checked: 'Checked on Arbitrum.',
  transactionNotFound: "Arbitrum doesn't show this transaction yet. Check the hash, or try again once it's confirmed.",
  transactionReverted: 'This transaction failed on Arbitrum. Send the refund again and record the new hash.',
  transactionAlreadyRecorded:
    'This transaction is already recorded as the refund of another order. Send this refund in its own transaction.',
  transactionWrongRecipient:
    "This transaction sent no USDT to the buyer's refund address. Check that you sent it to the address above.",
  feeHint:
    'Bitkit can take the network fee in USDT. Keep the amount plus the fee in your wallet so the buyer receives the full refund.',
  referenceLabel: 'Arbitrum transaction hash',
  referenceRequired: 'Enter the Arbitrum transaction hash (0x followed by 64 characters).',
  railUnknown:
    'The buyer paid on both rails and the Shop cannot tell which one this refund returns. Resolve the order as paid or abandoned first.',
  amountUnrecordable:
    "This USDT amount cannot be recorded as a refund in this order's currency. Contact the marketplace operator.",
  recordHint: 'Send the refund from Bitkit to this address first, then record its Arbitrum transaction hash here.',
} as const;

export const USDT_REFUND_REFUSAL_COPY: ReadonlyMap<string, string> = new Map([
  ['refund_destination_required', USDT_REFUND_COPY.sellerWaiting],
  ['invalid_refund_destination', USDT_REFUND_COPY.addressInvalid],
  ['invalid_refund_reference', USDT_REFUND_COPY.referenceRequired],
  ['refund_transaction_not_found', USDT_REFUND_COPY.transactionNotFound],
  ['refund_transaction_reverted', USDT_REFUND_COPY.transactionReverted],
  ['refund_transaction_wrong_recipient', USDT_REFUND_COPY.transactionWrongRecipient],
  ['refund_transaction_already_recorded', USDT_REFUND_COPY.transactionAlreadyRecorded],
]);

/**
 * Refusals that only the seller's record or resolve step can meet, worded for
 * the seller. The buyer's `refund.confirm_destination` never reads this map:
 * the service raises these two only when a seller resolves a payment
 * (`POST /v0/orders/{id}/bitcoin/resolve`), and a buyer must not see seller
 * instructions if it ever raised them elsewhere.
 */
export const USDT_SELLER_REFUND_REFUSAL_COPY: ReadonlyMap<string, string> = new Map([
  ['refund_rail_unknown', USDT_REFUND_COPY.railUnknown],
  ['refund_amount_unrecordable', USDT_REFUND_COPY.amountUnrecordable],
]);

/**
 * The static copy for a USDT refund refusal from `refund.confirm_destination`
 * or `refund.record_external`; `seller` adds the seller-only refusals. Reads the closed `reason` (or a message that is
 * exactly that token) and never echoes service text, which could carry the
 * rejected address.
 */
export function usdtRefundRefusalMessage(
  error: { reason?: unknown; message?: unknown },
  { seller = false }: { seller?: boolean } = {},
): string | null {
  for (const candidate of [error.reason, error.message]) {
    if (typeof candidate !== 'string') continue;
    const token = candidate.trim();
    const copy =
      USDT_REFUND_REFUSAL_COPY.get(token) ?? (seller ? USDT_SELLER_REFUND_REFUSAL_COPY.get(token) : undefined);
    if (copy) return copy;
  }
  return null;
}

/**
 * The receipt line for a recorded USDT refund. When the service checked the
 * transaction on Arbitrum (`receivedUnits`), it says so, and a short refund
 * names what was received against what was recorded. Otherwise it states what
 * the seller recorded and that the Shop hasn't checked it. The Paykit
 * `refunded` outcome is an annotation, never an independently verified
 * on-chain refund (D5).
 */
export function usdtRefundRecordLine(order: UsdtRefundOrder): string | null {
  const refund = order.externalRefund;
  if (!refund || !isUsdtRefundOrder(order)) return null;
  const cap = usdtRefundCap(order);
  const amount = formatUsdtRefundAmount(order, refund.amountMinor, { grouped: true });
  const destination = order.refundDestination ? ` to ${order.refundDestination.address}` : '';
  const capMinor = usdtRefundCapMinor(order) ?? order.total.amountMinor;
  const isPartial = order.state === 'refunded_partial' || refund.amountMinor < capMinor;
  const scope = isPartial
    ? cap
      ? ` (${formatUsdt(refund.amountMinor, { grouped: true })} of ${formatUsdt(cap.amountMinor, { grouped: true })})`
      : ` (${formatCommerceMoney({ ...order.total, amountMinor: refund.amountMinor })} of ${formatCommerceMoney({ ...order.total, amountMinor: capMinor })})`
    : '';
  const what = amount ? `a refund of ${amount}${scope}` : `a refund${scope}`;
  const received = refund.receivedUnits;
  if (typeof received !== 'number') {
    return `The seller recorded ${what}${destination} (transaction ${refund.transactionId}). ${USDT_REFUND_COPY.notChecked}`;
  }
  const recordedUnits = cap
    ? refund.amountMinor
    : usdtParityMillionths({ ...order.total, amountMinor: refund.amountMinor });
  if (recordedUnits !== null && received < recordedUnits) {
    return `The seller recorded ${what}${destination} (transaction ${refund.transactionId}). Arbitrum shows ${formatUsdt(received, { grouped: true })} received of ${formatUsdt(recordedUnits, { grouped: true })}.`;
  }
  return `The seller refunded ${amount ?? formatUsdt(received, { grouped: true })}${scope}${destination} (transaction ${refund.transactionId}). ${USDT_REFUND_COPY.checked}`;
}
