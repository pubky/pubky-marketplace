import { z } from 'zod';
import {
  BASE_UNITS_PER_BITCOIN as REGISTRY_BASE_UNITS_PER_BITCOIN,
  BITCOIN_CURRENCY_CODE,
  BITCOIN_EXPONENT,
  LISTING_CURRENCY_REGISTRY,
  type ListingCurrencyCode,
  MAX_BITCOIN_BASE_UNITS as REGISTRY_MAX_BITCOIN_BASE_UNITS,
  resolveListingCurrency,
} from '@/config/currencies';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { formatBitcoinBaseUnits } from '@/pipes/money/money.format';
import { amountInputText, parseAmountInput } from '@/pipes/money/money.parse';
import type { CommerceMoney } from './transaction-contracts';

/**
 * Asset-aware price input helpers.
 *
 * Listings carry structured money `{amountMinor, currency, exponent}` in the
 * seller's chosen listing currency (`@/config/currencies`). This module turns
 * what a user types into exact minor units for the asset they are transacting
 * in (decimal major units for fiat, whole bitcoin base units for BTC at
 * exponent 8). No conversion ever happens here: a bitcoin input IS the minor
 * unit, a USD input is multiplied by 10^2, nothing else. Display formatting
 * and indicative conversion live in `@/pipes/money/*`; the rate-at-payment
 * question is answered by the service at checkout, see docs/ecommerce/pricing.md.
 */

export const BASE_UNITS_PER_BITCOIN = REGISTRY_BASE_UNITS_PER_BITCOIN;

/** 21 million bitcoin in base units — the honest upper bound for any ₿ amount. */
export const MAX_BITCOIN_BASE_UNITS = REGISTRY_MAX_BITCOIN_BASE_UNITS;

export type CommerceAsset = Pick<CommerceMoney, 'currency' | 'exponent'>;

function assetForRegistryCode(code: ListingCurrencyCode): CommerceAsset {
  const { exponent } = LISTING_CURRENCY_REGISTRY[code];
  return { currency: code, exponent };
}

export const USD_ASSET: CommerceAsset = assetForRegistryCode('USD');

/** Bitcoin priced in integer base units (exponent 8) — the convention this app writes and pays. */
export const BTC_ASSET: CommerceAsset = assetForRegistryCode(BITCOIN_CURRENCY_CODE);

export function isBitcoinAsset(asset: CommerceAsset): boolean {
  return asset.currency === BITCOIN_CURRENCY_CODE && asset.exponent === BITCOIN_EXPONENT;
}

/**
 * The pricing currencies the sell studio offers: the seven listing fiat
 * currencies (minor units per ISO 4217) or bitcoin entered as whole base units
 * (BTC at exponent 8 — the exact shape the live regtest purchase paid). The
 * record schema itself accepts any uppercase asset code; this choice is what the
 * studio can author and the display layer can honestly estimate against.
 */
export type ListingCurrencyChoice = ListingCurrencyCode;

export function assetForListingCurrency(choice: ListingCurrencyChoice): CommerceAsset {
  return assetForRegistryCode(choice);
}

/** The studio choice a stored asset maps back to, or `null` for assets the studio cannot author. */
export function listingCurrencyChoiceForAsset(asset: CommerceAsset): ListingCurrencyChoice | null {
  const definition = resolveListingCurrency(asset);
  if (!definition) return null;
  // A satoshi-denominated price (`SAT`/0) is read, but the studio only authors `BTC`/8.
  return definition.code === asset.currency ? definition.code : null;
}

export function hasSameAsset(left: CommerceAsset, right: CommerceAsset): boolean {
  return left.currency === right.currency && left.exponent === right.exponent;
}

/** BIP-177 display: the bitcoin symbol followed by grouped integer base units, e.g. `₿15,000`. */
export function formatBitcoinAmount(baseUnits: number): string {
  return formatBitcoinBaseUnits(baseUnits);
}

/** The unit a price input for this asset is denominated in, for labels like `Price (₿)`. */
export function amountInputUnitLabel(asset: CommerceAsset): string {
  return isBitcoinAsset(asset) ? '₿' : asset.currency;
}

export interface AmountExample {
  /** The example in major units for a currency that has a fraction (dollars, euros, francs, pounds). */
  major: number;
  /** The example in whole bitcoin base units. */
  bitcoinBaseUnits: number;
}

/** Example amounts for the price fields; each renders valid in the asset's own entry unit. */
export const AMOUNT_EXAMPLES = {
  price: { major: 125, bitcoinBaseUnits: 150_000 },
  shipping: { major: 12, bitcoinBaseUnits: 15_000 },
  offer: { major: 100, bitcoinBaseUnits: 100_000 },
  counterOffer: { major: 110, bitcoinBaseUnits: 110_000 },
} as const satisfies Record<string, AmountExample>;

/** Currencies with no fraction (yen) have prices a hundred times the dollar-scale example. */
const WHOLE_UNIT_EXAMPLE_SCALE = 100;

/**
 * An input placeholder valid in the asset's own entry unit: `125.00` for
 * dollars, `12500` for yen (no decimal point), `150000` for ₿ base units.
 */
export function amountInputExample(asset: CommerceAsset, example: AmountExample): string {
  if (isBitcoinAsset(asset)) return String(example.bitcoinBaseUnits);
  if (asset.exponent === 0) return String(example.major * WHOLE_UNIT_EXAMPLE_SCALE);
  return example.major.toFixed(asset.exponent);
}

/**
 * Validation for a price typed in the asset's input unit: whole bitcoin base
 * units for BTC/8, otherwise a decimal with at most `exponent` fraction digits.
 */
export function amountInputSchemaForAsset(asset: CommerceAsset): z.ZodType<string> {
  if (isBitcoinAsset(asset)) {
    return z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, 'Enter a whole number of bitcoin base units (₿).')
      .refine((value) => Number(value) <= MAX_BITCOIN_BASE_UNITS, 'That is more bitcoin than will ever exist.');
  }
  const decimals = asset.exponent;
  const message =
    decimals > 0
      ? `Enter a valid ${asset.currency} amount with at most ${decimals} decimal places.`
      : `Enter a whole ${asset.currency} amount.`;
  return z
    .string()
    .trim()
    .refine((value) => parseAmountInput(value, asset) !== null, message)
    .refine((value) => (parseAmountInput(value, asset)?.amountMinor ?? 0) > 0, 'Amount must be greater than zero.');
}

/**
 * A validated input string → exact minor units in the given asset. Callers run
 * {@link amountInputSchemaForAsset} first, so a string that does not parse is a
 * programming error rather than user input.
 */
export function amountInputToMoney(value: string, asset: CommerceAsset): CommerceMoney {
  const money = parseAmountInput(value, asset);
  if (money === null) {
    throw Err.validation(ValidationErrorCode.INVALID_INPUT, `Not a valid ${asset.currency} amount`, {
      service: ErrorService.Local,
      operation: 'amountInputToMoney',
      context: { currency: asset.currency },
    });
  }
  return money;
}

/** Minor units → the input string a form should show for this asset. */
export function amountInputFromMoney(money: CommerceMoney): string {
  return amountInputText(money);
}

/**
 * Sums line prices grouped by exact asset (currency + exponent). Minor units
 * of different assets are never added together — a cart holding a $30 item
 * and a ₿25,000 item has two subtotals, not one false number.
 */
export function sumMoneyByAsset(lines: Array<{ money: CommerceMoney; quantity: number }>): CommerceMoney[] {
  const totals = new Map<string, CommerceMoney>();
  for (const { money, quantity } of lines) {
    const key = `${money.currency}:${money.exponent}`;
    const existing = totals.get(key);
    if (existing) {
      existing.amountMinor += money.amountMinor * quantity;
    } else {
      totals.set(key, {
        amountMinor: money.amountMinor * quantity,
        currency: money.currency,
        exponent: money.exponent,
      });
    }
  }
  return [...totals.values()];
}
