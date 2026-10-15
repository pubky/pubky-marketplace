import { CURRENCY_FORMAT_LOCALE, resolveListingCurrency } from '@/config/currencies';
import type { Money } from './money.types';

const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string, exponent: number): Intl.NumberFormat {
  const key = `${currency}:${exponent}`;
  let format = currencyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(CURRENCY_FORMAT_LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    });
    currencyFormats.set(key, format);
  }
  return format;
}

/** BIP-177 display: the bitcoin symbol followed by grouped integer base units, e.g. `₿15,000`. */
export function formatBitcoinBaseUnits(baseUnits: number): string {
  return `₿${Math.round(baseUnits).toLocaleString(CURRENCY_FORMAT_LOCALE)}`;
}

/**
 * A price as the buyer reads it, in its own currency and never rounded to
 * another: bitcoin as `₿15,000` (its minor unit, stated exactly), fiat through
 * `Intl` with exactly the currency's exponent (`$125.00`, `€12.50`, `¥1,500`,
 * `CA$9.99`). An asset outside the registry falls back to `1,234.50 CODE`.
 */
export function formatMoney(money: Money): string {
  if (resolveListingCurrency(money)?.kind === 'bitcoin') {
    return formatBitcoinBaseUnits(money.amountMinor);
  }
  const value = money.amountMinor / 10 ** money.exponent;
  if (/^[A-Z]{3}$/.test(money.currency)) {
    try {
      return currencyFormat(money.currency, money.exponent).format(value);
    } catch {
      // An unknown ISO code falls through to the deterministic asset-code form.
    }
  }
  return `${value.toLocaleString(CURRENCY_FORMAT_LOCALE, {
    minimumFractionDigits: money.exponent,
    maximumFractionDigits: money.exponent,
  })} ${money.currency}`;
}
