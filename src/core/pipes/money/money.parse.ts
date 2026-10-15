import { MAX_BITCOIN_BASE_UNITS, resolveListingCurrency } from '@/config/currencies';
import type { Money } from './money.types';

/**
 * Parses a decimal amount typed in major units ("125.50") into exact minor
 * units, with string arithmetic only. Never rounds: more fraction digits than
 * the exponent allows is rejected, so "0.001" cannot silently become zero or a
 * cent. Returns `null` for anything that is not a plain non-negative decimal or
 * does not fit a safe integer.
 */
export function parseMajorAmountToMinor(input: string, exponent: number): number | null {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = Number(`${whole}${fraction.padEnd(exponent, '0')}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Exact minor units → the major-unit decimal string a form shows ("12500", 2 → "125.00"). */
export function minorToMajorString(amountMinor: number, exponent: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return '';
  if (exponent === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * What a seller or buyer types for a price in this asset → exact minor units.
 * Fiat is typed in major units. Bitcoin is typed as whole base units (₿), which
 * ARE its minor units, so nothing is scaled. Returns `null` when the text is not
 * a valid amount for the asset or exceeds 21 million bitcoin.
 */
export function parseAmountInput(input: string, asset: { currency: string; exponent: number }): Money | null {
  const definition = resolveListingCurrency(asset);
  const trimmed = input.trim();
  if (definition?.entryUnit === 'minor') {
    if (!/^\d+$/.test(trimmed)) return null;
    const baseUnits = Number(trimmed);
    if (!Number.isSafeInteger(baseUnits) || baseUnits > MAX_BITCOIN_BASE_UNITS) return null;
    return { amountMinor: baseUnits, currency: asset.currency, exponent: asset.exponent };
  }
  const amountMinor = parseMajorAmountToMinor(trimmed, asset.exponent);
  return amountMinor === null ? null : { amountMinor, currency: asset.currency, exponent: asset.exponent };
}

/** The inverse of {@link parseAmountInput}: the text a form shows for a stored price. */
export function amountInputText(money: Money): string {
  const definition = resolveListingCurrency(money);
  return definition?.entryUnit === 'minor'
    ? String(money.amountMinor)
    : minorToMajorString(money.amountMinor, money.exponent);
}
