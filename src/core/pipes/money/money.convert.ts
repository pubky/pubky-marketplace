import {
  BITCOIN_CURRENCY_CODE,
  LISTING_CURRENCY_REGISTRY,
  type ListingCurrencyCode,
  resolveListingCurrency,
} from '@/config/currencies';
import { formatMoney } from './money.format';
import type { FxRateSnapshot, Money } from './money.types';

/** An exact ratio, so conversions never pick up floating-point error. */
interface Rational {
  numerator: bigint;
  denominator: bigint;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

/** Parses a quoted price ("81248", "81248.5") into an exact positive ratio, or `null`. */
function parsePositiveDecimal(value: string | undefined): Rational | null {
  if (value === undefined) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= ZERO) return null;
  return { numerator, denominator: TEN ** BigInt(fraction.length) };
}

/** What one bitcoin is worth in the currency's own major unit: 1 for bitcoin, the quoted price for fiat. */
function bitcoinWorthIn(code: ListingCurrencyCode, snapshot: FxRateSnapshot): Rational | null {
  if (code === BITCOIN_CURRENCY_CODE) return { numerator: ONE, denominator: ONE };
  return parsePositiveDecimal(snapshot.fiatPerBtc[code]);
}

/** Integer division rounding half up (amounts here are never negative). */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO);
}

/**
 * Converts a price into another listing currency with one rate snapshot.
 *
 * Everything routes through bitcoin, so fiat to fiat is two tickers of the
 * same snapshot (EUR to CHF = EUR→BTC→CHF) and bitcoin to fiat or back is one.
 * The result is rounded half up to the target's minor unit. A converted
 * amount that rounds to zero is returned as zero; callers that render a hint
 * hide it. Returns `null` when the amount is not a non-negative safe integer,
 * the source is not a listing currency, a needed rate is missing, or the
 * result does not fit a safe integer.
 *
 * Indicative use only: the amount a payment settles at is fixed by the
 * service at checkout, never by this function.
 */
export function convertMoney(money: Money, target: ListingCurrencyCode, snapshot: FxRateSnapshot): Money | null {
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0) return null;
  const source = resolveListingCurrency(money);
  if (!source) return null;
  const destination = LISTING_CURRENCY_REGISTRY[target];
  if (source.code === destination.code) {
    return { amountMinor: money.amountMinor, currency: destination.code, exponent: destination.exponent };
  }

  const sourceWorth = bitcoinWorthIn(source.code, snapshot);
  const destinationWorth = bitcoinWorthIn(destination.code, snapshot);
  if (!sourceWorth || !destinationWorth) return null;

  // minor_to = minor_from * 10^exp_to * worth_to / (10^exp_from * worth_from)
  const numerator =
    BigInt(money.amountMinor) *
    TEN ** BigInt(destination.exponent) *
    destinationWorth.numerator *
    sourceWorth.denominator;
  const denominator = TEN ** BigInt(source.exponent) * destinationWorth.denominator * sourceWorth.numerator;
  const converted = divideRoundHalfUp(numerator, denominator);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return { amountMinor: Number(converted), currency: destination.code, exponent: destination.exponent };
}

/**
 * The currency a hint is shown in: the buyer's display currency, except when
 * the price is already in it. Then the hint is the other side of the
 * fiat-and-bitcoin pair (dollars under a bitcoin price, bitcoin under a fiat
 * price), so a buyer who displays in the listing's own currency still gets a
 * useful reference.
 */
export function hintTargetCurrency(listing: ListingCurrencyCode, display: ListingCurrencyCode): ListingCurrencyCode {
  if (display !== listing) return display;
  return listing === BITCOIN_CURRENCY_CODE ? 'USD' : BITCOIN_CURRENCY_CODE;
}

/**
 * The approximate converted counterpart shown beside a price, such as
 * `≈ €11.50`. Returns `null` whenever no honest hint exists: the price is not
 * in a listing currency, the snapshot lacks a needed rate, or the estimate is
 * zero in the hint currency.
 */
export function indicativeHintLabel(
  money: Money,
  display: ListingCurrencyCode,
  snapshot: FxRateSnapshot,
): string | null {
  const source = resolveListingCurrency(money);
  if (!source) return null;
  const converted = convertMoney(money, hintTargetCurrency(source.code, display), snapshot);
  if (!converted || converted.amountMinor === 0) return null;
  return `≈ ${formatMoney(converted)}`;
}
