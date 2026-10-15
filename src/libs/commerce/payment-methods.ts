import { z } from 'zod';
import type { PAYMENT_METHOD_KINDS } from '@/libs/commerce/payment-options';
import type { CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import { usdtSetupActionSchema, usdtSetupStatusSchema } from '@/libs/commerce/usdt-seller-setup';

/**
 * Seller-configurable payment methods (docs/ecommerce/fiat-rails-phase1.md,
 * "seller-direct" custody decision): the seller owns every processor
 * relationship. This marketplace never receives funds on any rail —
 * bitcoin settles to the seller's own claimed watch-only account via
 * Paykit, and PayPal settles into the seller's own PayPal account. The
 * service records attestations (PayPal, buyer-reported and seller-confirmed).
 */
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/**
 * The delivery address an auction winner sends with the payment method: the
 * winner's order is created at close, before anyone has said where to ship.
 * Sealed to the seller's delivery key like a checkout address; plaintext only
 * where the seller published no key and the deployment still allows it.
 */
export type BindDeliveryAddress =
  | { deliveryAddressEnvelope: { keyId: string; envelope: string } }
  | { deliveryAddress: CommerceDeliveryAddressValue };

/**
 * Public view of one seller's payment rails, served unauthenticated so buyers
 * can see the available methods before committing. Booleans only: the
 * seller's PayPal email never enters this
 * view. PayPal checkout opens the `fiatCheckoutUrl` the service returns on the
 * buyer's own bound order.
 *
 * A service that still sends `paypal_merchant_email` instead of
 * `paypal_available` is read for presence only; the address is dropped here
 * and never reaches the caller.
 */
export const sellerPaymentConfigSchema = z
  .object({
    bitcoinAvailable: z.boolean(),
    bitcoinOfferAvailable: z.boolean().optional().default(true),
    paypalAvailable: z.boolean().optional(),
    paypalMerchantEmail: z.string().nullable().optional(),
    // Present only when the service's USDT flag is on. A malformed value is
    // dropped, which reads as "not available".
    usdtAvailable: z.boolean().optional().catch(undefined),
  })
  .transform(
    ({
      bitcoinAvailable,
      bitcoinOfferAvailable,
      paypalAvailable,
      paypalMerchantEmail,
      usdtAvailable,
    }): {
      bitcoinAvailable: boolean;
      bitcoinOfferAvailable: boolean;
      paypalAvailable: boolean;
      usdtAvailable?: boolean;
    } => ({
      bitcoinAvailable,
      bitcoinOfferAvailable,
      paypalAvailable: paypalAvailable ?? Boolean(paypalMerchantEmail),
      ...(usdtAvailable === undefined ? {} : { usdtAvailable }),
    }),
  );

export type SellerPaymentConfig = z.infer<typeof sellerPaymentConfigSchema>;

/**
 * Methods the buyer can actually choose, in the order the UI renders them.
 * USDT is offered only when the caller's gate
 * (`usdtPaymentsAvailable`: Shop flag AND service capability) is on AND the
 * seller's public config says `usdtAvailable`; every existing caller omits the
 * gate, so their result is unchanged.
 */
export function availablePaymentMethods(
  config: SellerPaymentConfig,
  { usdtPaymentsAvailable = false }: { usdtPaymentsAvailable?: boolean } = {},
): PaymentMethodKind[] {
  const methods: PaymentMethodKind[] = [];
  if (config.bitcoinAvailable && config.bitcoinOfferAvailable) methods.push('bitcoin');
  if (usdtPaymentsAvailable && config.usdtAvailable === true) methods.push('usdt');
  if (config.paypalAvailable) methods.push('paypal');
  return methods;
}

export const BITCOIN_SETUP_STATUSES = ['ready', 'setup_required', 'unavailable'] as const;
export type BitcoinSetupStatus = (typeof BITCOIN_SETUP_STATUSES)[number];

/**
 * The service's uncached Paykit answer for receiving Bitcoin (`bitcoin_setup`),
 * present whether or not Bitcoin is switched on. An unrecognised value is
 * dropped, which reads as "readiness unknown".
 */
const bitcoinSetupSchema = z.enum(BITCOIN_SETUP_STATUSES).optional().catch(undefined);

/**
 * The seller's own view when editing the configuration. Mirrors the
 * service's `payment_config` response.
 */
export const sellerPaymentConfigOwnViewSchema = z.object({
  bitcoinEnabled: z.boolean(),
  bitcoinSetup: bitcoinSetupSchema,
  // Present only when the service's USDT flag is on (the seller's Shop-level consent).
  usdtEnabled: z.boolean().optional().catch(undefined),
  // Readiness from the service's signed Paykit lookup (see usdt-seller-setup.ts).
  usdtSetup: usdtSetupStatusSchema,
  usdtSetupAction: usdtSetupActionSchema,
  paypalMerchantEmail: z.email().nullable(),
  updatedAt: z.string(),
});

export type SellerPaymentConfigOwnView = z.infer<typeof sellerPaymentConfigOwnViewSchema>;

/**
 * Whether the seller's Bitkit setup can receive Bitcoin: `true` for
 * `ready`, `false` for `setup_required`, and `null` when the service cannot
 * say (`unavailable`, or a service that predates the field). `null` is never a
 * reason to tell the seller Bitkit is missing.
 */
export function bitcoinSetupClaim(config: Pick<SellerPaymentConfigOwnView, 'bitcoinSetup'> | null): boolean | null {
  if (config?.bitcoinSetup === 'ready') return true;
  if (config?.bitcoinSetup === 'setup_required') return false;
  return null;
}

const PAYPAL_EMAIL_MAX_BYTES = 254;
const WHITESPACE_OR_CONTROL = /[\p{White_Space}\p{Cc}]/u;
const paypalEmailReadBackSchema = z.email();

/**
 * Whether the service accepts this PayPal email, mirroring its
 * `validate_paypal_email` (refused with `invalid_paypal_email`): at most 254
 * UTF-8 bytes, no whitespace or control characters, a non-empty local part,
 * and a dotted domain with no leading, trailing or doubled dot. The address
 * must also pass `z.email()`, which `sellerPaymentConfigOwnViewSchema` applies
 * when it reads the saved value back. Empty input clears PayPal and is valid.
 * This checks the shape only, not that a PayPal account exists.
 */
export function isValidPaypalMerchantEmail(value: string): boolean {
  const email = value.trim();
  if (email === '') return true;
  if (new TextEncoder().encode(email).length > PAYPAL_EMAIL_MAX_BYTES) return false;
  if (WHITESPACE_OR_CONTROL.test(email)) return false;
  const at = email.indexOf('@');
  if (at === -1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local === '' || domain === '' || !domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return paypalEmailReadBackSchema.safeParse(email).success;
}

/**
 * Client-side sanity check for a pasted BIP84 account key before it is sent
 * to the claim endpoint (which performs the authoritative parse). Accepts
 * the mainnet and testnet/regtest account-xpub encodings a wallet exports
 * for native-segwit accounts, plus the raw xpub/tpub forms some tools emit.
 */
const ACCOUNT_XPUB_PREFIXES = ['zpub', 'vpub', 'xpub', 'tpub'];
const BASE58_CHARS = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function isPlausibleAccountXpub(value: string): boolean {
  const trimmed = value.trim();
  const prefix = ACCOUNT_XPUB_PREFIXES.find((candidate) => trimmed.startsWith(candidate));
  if (!prefix) return false;
  // Serialized extended keys are 111-112 base58 characters.
  if (trimmed.length < 100 || trimmed.length > 120) return false;
  return BASE58_CHARS.test(trimmed);
}
