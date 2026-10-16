import type { ConnectorCatalogProduct } from '@/libs/commerce/connectors';
import { formatCommerceMoney } from '@/libs/commerce/format';

/** "CHF 25.00" for one price, "CHF 25.00 to CHF 40.00" for a range; empty when the product has no variants. */
export function productPriceLabel(product: ConnectorCatalogProduct): string {
  const prices = product.variants.map((variant) => variant.price);
  const first = prices[0];
  if (!first) return '';
  const sameCurrency = prices.every((price) => price.currency === first.currency && price.exponent === first.exponent);
  if (!sameCurrency) return formatCommerceMoney(first);
  const sorted = [...prices].sort((a, b) => a.amountMinor - b.amountMinor);
  const low = sorted[0] ?? first;
  const high = sorted[sorted.length - 1] ?? first;
  return low.amountMinor === high.amountMinor
    ? formatCommerceMoney(low)
    : `${formatCommerceMoney(low)} to ${formatCommerceMoney(high)}`;
}

/** What the picker says about stock: a count, a mix, or that the store does not track it. */
export function productStockLabel(product: ConnectorCatalogProduct): string {
  const counts = product.variants.map((variant) => variant.stock ?? null);
  if (counts.length === 0 || counts.every((count) => count === null)) return 'Stock not tracked in your store';
  const known = counts.filter((count): count is number => count !== null);
  const total = known.reduce((sum, count) => sum + Math.max(0, count), 0);
  return known.length === counts.length ? `${total} in stock` : `${total} in stock, some variants not tracked`;
}

export function productVariantLabel(product: ConnectorCatalogProduct): string {
  const count = product.variants.length;
  return count === 1 ? '1 variant' : `${count} variants`;
}
