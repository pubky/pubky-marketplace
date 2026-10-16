import { formatMoney } from '@/pipes/money/money.format';
import type { CommerceMoney } from './transaction-contracts';

/** A price in its own currency; see `formatMoney` for the per-currency rules. */
export function formatCommerceMoney(money: CommerceMoney): string {
  return formatMoney(money);
}

export function formatCommerceCondition(condition: string): string {
  return condition
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
