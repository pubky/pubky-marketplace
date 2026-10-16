import type { ConnectorCatalogProduct } from '@/libs/commerce/connectors';

/** Case-insensitive match on a product's title, its SKUs and its variant titles; an empty query matches all. */
export function productMatchesSearch(product: ConnectorCatalogProduct, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (product.title.toLowerCase().includes(needle)) return true;
  return product.variants.some(
    (variant) =>
      (variant.sku ?? '').toLowerCase().includes(needle) || (variant.title ?? '').toLowerCase().includes(needle),
  );
}
