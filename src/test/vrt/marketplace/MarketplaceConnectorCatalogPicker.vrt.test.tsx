// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceConnectorCatalogPicker } from '@/organisms/Marketplace/MarketplaceConnectorCatalogPicker';
import type { useConnectorCatalog } from '@/hooks/useConnectorCatalog/useConnectorCatalog';
import { connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { productMatchesSearch } from '@/pipes/commerce/connector-catalog-search';

type Catalog = ReturnType<typeof useConnectorCatalog>;

const PRODUCTS = [
  connectorCatalogProductSchema.parse({
    providerProductId: '101',
    title: 'The Little Hodler Socks Bundle',
    variants: [
      { providerVariantId: '1', sku: 'SOCK-S', price: { amountMinor: 2500, currency: 'CHF', exponent: 2 }, stock: 8 },
      { providerVariantId: '2', sku: 'SOCK-M', price: { amountMinor: 3000, currency: 'CHF', exponent: 2 }, stock: 5 },
      { providerVariantId: '3', sku: 'SOCK-L', price: { amountMinor: 3000, currency: 'CHF', exponent: 2 }, stock: 0 },
    ],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '102',
    title: 'Satoshi Notebook, A5, dotted',
    variants: [{ providerVariantId: '4', sku: 'NOTE-A5', price: { amountMinor: 1800, currency: 'CHF', exponent: 2 } }],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '103',
    title: 'Cold Card Hardware Wallet',
    variants: [
      { providerVariantId: '5', sku: 'COLD-1', price: { amountMinor: 14900, currency: 'CHF', exponent: 2 }, stock: 12 },
    ],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '104',
    title: 'Plan B Poster',
    variants: [{ providerVariantId: '6', price: { amountMinor: 3500, currency: 'CHF', exponent: 2 }, stock: 40 }],
  }),
];

function catalog(overrides: Partial<Catalog> = {}): Catalog {
  const search = overrides.search ?? '';
  const chosen = new Set(['101', '103']);
  const mapped = new Set(['103']);
  const visible = PRODUCTS.filter((product) => productMatchesSearch(product, search));
  return {
    products: PRODUCTS,
    visible,
    chosen,
    saved: new Set(['103']),
    mapped,
    isLoading: false,
    isLoadingMore: false,
    isSaving: false,
    error: null,
    needsSession: false,
    search,
    setSearch: () => {},
    isLocked: (id: string) => mapped.has(id),
    toggle: () => {},
    selectVisible: () => {},
    clearVisible: () => {},
    save: async () => true,
    dirty: true,
    chosenCount: chosen.size,
    reload: async () => {},
    ...overrides,
  };
}

function Picker({ value }: { value: Catalog }) {
  return (
    <main className="w-full py-6">
      <MarketplaceConnectorCatalogPicker catalog={value} />
    </main>
  );
}

describe('Store catalog picker — visual regression', () => {
  it('renders the product list at desktop viewport', async () => {
    await renderForVRT(<Picker value={catalog()} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-catalog-picker')).toMatchScreenshot('catalog-picker-list-desktop');
  });

  it('renders the product list at mobile viewport', async () => {
    await renderForVRT(<Picker value={catalog()} />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(await expectVrtSurface('store-catalog-picker')).toMatchScreenshot('catalog-picker-list-mobile');
  });

  it('renders a search with a match at desktop viewport', async () => {
    await renderForVRT(<Picker value={catalog({ search: 'note' })} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(await expectVrtSurface('store-catalog-picker')).toMatchScreenshot('catalog-picker-search-desktop');
  });

  it('renders a search with no match at desktop viewport', async () => {
    await renderForVRT(<Picker value={catalog({ search: 'tulip' })} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(await expectVrtSurface('store-catalog-picker')).toMatchScreenshot('catalog-picker-no-match-desktop');
  });
});
