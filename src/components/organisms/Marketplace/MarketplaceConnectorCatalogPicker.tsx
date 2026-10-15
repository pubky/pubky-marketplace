'use client';

import { CheckCircle2, LoaderCircle, Package, Save, Search } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Input } from '@/atoms/Input/Input';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import type { useConnectorCatalog } from '@/hooks/useConnectorCatalog/useConnectorCatalog';
import type { ConnectorCatalogProduct } from '@/libs/commerce/connectors';
import { productPriceLabel, productStockLabel, productVariantLabel } from '@/pipes/commerce/connector-catalog-summary';

type Catalog = ReturnType<typeof useConnectorCatalog>;

type MarketplaceConnectorCatalogPickerProps = {
  catalog: Catalog;
  /** Extra controls beside Save, for example the publish button. */
  actions?: React.ReactNode;
};

function safeImage(product: ConnectorCatalogProduct): string | null {
  const url = product.imageUrls[0];
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function ProductRow({ product, catalog }: { product: ConnectorCatalogProduct; catalog: Catalog }) {
  const id = product.providerProductId;
  const locked = catalog.isLocked(id);
  const checked = catalog.chosen.has(id);
  const image = safeImage(product);
  const checkboxId = `connector-product-${id}`;

  return (
    <li
      className="flex items-start gap-4 rounded-md border border-dashed border-border p-4"
      data-testid="connector-product"
      data-selected={checked}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={locked}
        onCheckedChange={() => catalog.toggle(id)}
        aria-label={`Also publish ${product.title} on Pubky`}
        className="mt-1"
      />
      <div className="size-16 shrink-0 overflow-hidden rounded-md bg-background">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- store photos come from the seller's own shop host
          <img src={image} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Package className="size-6" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <label htmlFor={checkboxId} className="text-sm leading-snug font-semibold break-words">
          {product.title}
        </label>
        <Typography as="p" className="text-xs text-muted-foreground">
          {[productPriceLabel(product), productVariantLabel(product), productStockLabel(product)]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Typography as="p" className="text-xs text-muted-foreground">
          {checked ? 'Also publish on Pubky' : 'Not published on Pubky'}
        </Typography>
      </div>
      {locked && (
        <Badge variant="secondary" className="bg-brand/20 text-brand">
          <CheckCircle2 aria-hidden="true" />
          Published
        </Badge>
      )}
    </li>
  );
}

/**
 * The store's products with an "Also publish on Pubky" checkbox each, a search
 * box, and Save. A product that is already published stays ticked: the choice
 * to publish is kept on the service and cannot be dropped while a listing
 * exists.
 */
export function MarketplaceConnectorCatalogPicker({ catalog, actions }: MarketplaceConnectorCatalogPickerProps) {
  if (catalog.isLoading) {
    return (
      <div className="grid gap-3" data-testid="connector-catalog-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <Card className="rounded-md p-0 shadow-lg" data-surface="store-catalog-picker" data-testid="connector-catalog">
      <CardContent className="grid gap-4 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={catalog.search}
              onChange={(event) => catalog.setSearch(event.target.value)}
              placeholder="Search products or SKUs"
              aria-label="Search store products"
              className="pl-9"
            />
          </div>
          <Typography as="p" className="text-sm text-muted-foreground" data-testid="connector-selected-count">
            {catalog.chosenCount} selected of {catalog.products.length}
            {catalog.isLoadingMore ? ', loading more' : ''}
          </Typography>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={catalog.selectVisible}>
            Select all shown
          </Button>
          <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={catalog.clearVisible}>
            Clear shown
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            disabled={!catalog.dirty || catalog.isSaving}
            onClick={() => void catalog.save()}
          >
            {catalog.isSaving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Save choice
          </Button>
          {actions}
        </div>

        {catalog.visible.length === 0 ? (
          <Typography
            as="p"
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="connector-catalog-empty"
          >
            {catalog.products.length === 0
              ? 'No products found in this store yet.'
              : `No products match "${catalog.search.trim()}".`}
          </Typography>
        ) : (
          <ul className="grid list-none gap-3 p-0">
            {catalog.visible.map((product) => (
              <ProductRow key={product.providerProductId} product={product} catalog={catalog} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
