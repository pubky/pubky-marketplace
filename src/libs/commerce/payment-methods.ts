import { z } from 'zod';
import { PAYMENT_ASSETS, type PAYMENT_METHOD_KINDS, type PaymentAsset } from '@/libs/commerce/payment-options';
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
    // Present only while the service's USDT flag is on: whether this seller can
    // take a Paykit request at all, on any asset.
    paykitAvailable: z.boolean().optional().catch(undefined),
    // The assets one Paykit request offers for this seller. Unknown assets are
    // dropped; an absent or unreadable list falls back to `bitcoinAvailable` /
    // `usdtAvailable` in `sellerPaykitAssets`.
    acceptedAssets: z
      .array(z.string())
      .transform((assets) => PAYMENT_ASSETS.filter((asset) => assets.includes(asset)))
      .optional()
      .catch(undefined),
  })
  .transform(
    ({
      bitcoinAvailable,
      bitcoinOfferAvailable,
      paypalAvailable,
      paypalMerchantEmail,
      usdtAvailable,
      paykitAvailable,
      acceptedAssets,
    }): {
      bitcoinAvailable: boolean;
      bitcoinOfferAvailable: boolean;
      paypalAvailable: boolean;
      usdtAvailable?: boolean;
      paykitAvailable?: boolean;
      acceptedAssets?: PaymentAsset[];
    } => ({
      bitcoinAvailable,
      bitcoinOfferAvailable,
      paypalAvailable: paypalAvailable ?? Boolean(paypalMerchantEmail),
      ...(usdtAvailable === undefined ? {} : { usdtAvailable }),
      ...(paykitAvailable === undefined ? {} : { paykitAvailable }),
      ...(acceptedAssets === undefined ? {} : { acceptedAssets }),
    }),
  );

export type SellerPaymentConfig = z.infer<typeof sellerPaymentConfigSchema>;

/**
 * The assets one Paykit request from this seller offers, Bitcoin first. USDT
 * is counted only when the caller's gate (`usdtPaymentsAvailable`: Shop flag
 * AND service capability) is on, so a deployment with USDT off never says
 * "USDT". The service's `acceptedAssets` list wins when it sends one; older
 * services are read from `bitcoinAvailable` and `usdtAvailable`, and a
 * service that says `paykitAvailable: false` offers none. The
 * rail-wide Bitcoin offer gate removes Bitcoin either way.
 */
export function sellerPaykitAssets(
  config: SellerPaymentConfig,
  { usdtPaymentsAvailable = false }: { usdtPaymentsAvailable?: boolean } = {},
): PaymentAsset[] {
  if (config.paykitAvailable === false) return [];
  const bitcoin =
    (config.acceptedAssets ? config.acceptedAssets.includes('BTC') : config.bitcoinAvailable) &&
    config.bitcoinOfferAvailable;
  const usdt = config.acceptedAssets ? config.acceptedAssets.includes('USDT') : config.usdtAvailable === true;
  return PAYMENT_ASSETS.filter((asset) => (asset === 'BTC' ? bitcoin : usdtPaymentsAvailable && usdt));
}

/**
 * Methods the buyer can actually choose, in the order the UI renders them.
 * Paykit is one entry whatever the assets: it is offered when the seller takes
 * Bitcoin or, through the gate, USDT, and the buyer picks the asset in Bitkit.
 */
export function availablePaymentMethods(
  config: SellerPaymentConfig,
  options: { usdtPaymentsAvailable?: boolean } = {},
): PaymentMethodKind[] {
  const methods: PaymentMethodKind[] = [];
  if (sellerPaykitAssets(config, options).length > 0) methods.push('paykit');
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
