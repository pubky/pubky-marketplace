import { describe, expect, it } from 'vitest';
import { connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { productMatchesSearch } from './connector-catalog-search';
import { productPriceLabel, productStockLabel, productVariantLabel } from './connector-catalog-summary';

function product(
  variants: Array<{ amountMinor: number; currency?: string; stock?: number | null; sku?: string; title?: string }>,
) {
  return connectorCatalogProductSchema.parse({
    providerProductId: '1',
    title: 'The Little Hodler Socks Bundle',
    variants: variants.map((variant, index) => ({
      providerVariantId: `v${index}`,
      sku: variant.sku ?? null,
      title: variant.title ?? null,
      price: { amountMinor: variant.amountMinor, currency: variant.currency ?? 'CHF', exponent: 2 },
      stock: variant.stock ?? null,
    })),
  });
}

const plain = (text: string) => text.replaceAll('\u00a0', ' ');

describe('productPriceLabel', () => {
  it('shows one price, or the range across variants', () => {
    expect(plain(productPriceLabel(product([{ amountMinor: 2500 }])))).toBe('CHF 25.00');
    expect(
      plain(productPriceLabel(product([{ amountMinor: 4000 }, { amountMinor: 2500 }, { amountMinor: 2500 }]))),
    ).toBe('CHF 25.00 to CHF 40.00');
  });

  it('shows the first price when currencies differ, and nothing without variants', () => {
    expect(plain(productPriceLabel(product([{ amountMinor: 2500 }, { amountMinor: 2000, currency: 'EUR' }])))).toBe(
      'CHF 25.00',
    );
    expect(productPriceLabel(product([]))).toBe('');
  });
});

describe('productStockLabel', () => {
  it('says the store does not track stock rather than inventing a count', () => {
    expect(productStockLabel(product([{ amountMinor: 1 }]))).toBe('Stock not tracked in your store');
    expect(productStockLabel(product([]))).toBe('Stock not tracked in your store');
  });

  it('adds up tracked stock and flags a mix', () => {
    expect(
      productStockLabel(
        product([
          { amountMinor: 1, stock: 3 },
          { amountMinor: 1, stock: 4 },
        ]),
      ),
    ).toBe('7 in stock');
    expect(productStockLabel(product([{ amountMinor: 1, stock: 3 }, { amountMinor: 1 }]))).toBe(
      '3 in stock, some variants not tracked',
    );
    expect(productStockLabel(product([{ amountMinor: 1, stock: -2 }]))).toBe('0 in stock');
  });
});

describe('productVariantLabel', () => {
  it('counts variants', () => {
    expect(productVariantLabel(product([{ amountMinor: 1 }]))).toBe('1 variant');
    expect(productVariantLabel(product([{ amountMinor: 1 }, { amountMinor: 1 }]))).toBe('2 variants');
  });
});

describe('productMatchesSearch', () => {
  const socks = product([{ amountMinor: 1, sku: 'SOCK-S', title: 'Small' }]);

  it('matches title, SKU and variant title without regard to case', () => {
    expect(productMatchesSearch(socks, 'hodler')).toBe(true);
    expect(productMatchesSearch(socks, 'sock-s')).toBe(true);
    expect(productMatchesSearch(socks, 'SMALL')).toBe(true);
    expect(productMatchesSearch(socks, 'hat')).toBe(false);
  });

  it('matches everything for an empty query', () => {
    expect(productMatchesSearch(socks, '')).toBe(true);
    expect(productMatchesSearch(socks, '   ')).toBe(true);
  });
});
