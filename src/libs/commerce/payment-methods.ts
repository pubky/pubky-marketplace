import { z } from 'zod';
import type { PAYMENT_METHOD_KINDS } from '@/libs/commerce/payment-options';
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

/**
 * The seller's own view when editing the configuration. Mirrors the
 * service's `payment_config` response.
 */
export const sellerPaymentConfigOwnViewSchema = z.object({
  bitcoinEnabled: z.boolean(),
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
