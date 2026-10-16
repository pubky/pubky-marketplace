import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { useConnectorCatalog } from '@/hooks/useConnectorCatalog/useConnectorCatalog';
import { type ConnectorCatalogProduct, connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { productMatchesSearch } from '@/pipes/commerce/connector-catalog-search';
import { MarketplaceConnectorCatalogPicker } from './MarketplaceConnectorCatalogPicker';

type Catalog = ReturnType<typeof useConnectorCatalog>;

const PRODUCTS: ConnectorCatalogProduct[] = [
  connectorCatalogProductSchema.parse({
    providerProductId: '1',
    title: 'The Little Hodler Socks Bundle',
    imageUrls: ['https://dezentralshop.ch/a.jpg'],
    variants: [
      { providerVariantId: '11', sku: 'SOCK-S', price: { amountMinor: 2500, currency: 'CHF', exponent: 2 }, stock: 4 },
      { providerVariantId: '12', sku: 'SOCK-M', price: { amountMinor: 3000, currency: 'CHF', exponent: 2 }, stock: 2 },
    ],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '2',
    title: 'Satoshi Notebook',
    variants: [{ providerVariantId: '21', price: { amountMinor: 1800, currency: 'CHF', exponent: 2 } }],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '3',
    title: 'Cold Card',
    variants: [{ providerVariantId: '31', price: { amountMinor: 9900, currency: 'CHF', exponent: 2 }, stock: 0 }],
  }),
];

function Harness({ overrides = {}, save = vi.fn() }: { overrides?: Partial<Catalog>; save?: () => void }) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(['3']));
  const mapped = new Set(['3']);
  const visible = PRODUCTS.filter((product) => productMatchesSearch(product, search));
  const catalog = {
    products: PRODUCTS,
    visible,
    chosen,
    saved: new Set(['3']),
    mapped,
    isLoading: false,
    isLoadingMore: false,
    isSaving: false,
    error: null,
    needsSession: false,
    search,
    setSearch,
    isLocked: (id: string) => mapped.has(id),
    toggle: (id: string) => {
      if (mapped.has(id)) return;
      setChosen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    selectVisible: () =>
      setChosen((current) => new Set([...current, ...visible.map((product) => product.providerProductId)])),
    clearVisible: () => setChosen(new Set(['3'])),
    save: async () => {
      save();
      return true;
    },
    dirty: chosen.size !== 1,
    chosenCount: chosen.size,
    reload: async () => {},
    ...overrides,
  } as Catalog;
  return <MarketplaceConnectorCatalogPicker catalog={catalog} />;
}

describe('MarketplaceConnectorCatalogPicker', () => {
  it('lists every product with its price range, variants and stock, and an Also publish checkbox', () => {
    render(<Harness />);
    const rows = screen.getAllByTestId('connector-product');
    expect(rows).toHaveLength(3);

    const socks = rows[0] as HTMLElement;
    expect(socks).toHaveTextContent('The Little Hodler Socks Bundle');
    expect(socks).toHaveTextContent('CHF 25.00 to CHF 30.00');
    expect(socks).toHaveTextContent('2 variants');
    expect(socks).toHaveTextContent('6 in stock');
    expect(
      within(socks).getByRole('checkbox', { name: 'Also publish The Little Hodler Socks Bundle on Pubky' }),
    ).not.toBeChecked();
    expect(rows[1]).toHaveTextContent('Stock not tracked in your store');
  });

  it('keeps a published product ticked and locked, with a Published badge', () => {
    render(<Harness />);
    const locked = screen.getAllByTestId('connector-product')[2] as HTMLElement;
    expect(within(locked).getByRole('checkbox')).toBeChecked();
    expect(within(locked).getByRole('checkbox')).toBeDisabled();
    expect(within(locked).getByText('Published')).toBeInTheDocument();
  });

  it('ticks products, counts the choice and saves it', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<Harness save={save} />);
    expect(screen.getByRole('button', { name: 'Save choice' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Also publish Satoshi Notebook on Pubky' }));

    expect(screen.getByTestId('connector-selected-count')).toHaveTextContent('2 selected of 3');
    await user.click(screen.getByRole('button', { name: 'Save choice' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('searches and selects only what is shown', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('searchbox', { name: 'Search store products' }), 'sock-m');
    expect(screen.getAllByTestId('connector-product')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Select all shown' }));

    expect(screen.getByTestId('connector-selected-count')).toHaveTextContent('2 selected of 3');
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getAllByTestId('connector-product')).toHaveLength(3);
  });

  it('says when nothing matches the search', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByTestId('connector-catalog-empty')).toHaveTextContent('No products match "zzz".');
  });

  it('says when the store has no products', () => {
    render(<Harness overrides={{ products: [], visible: [] }} />);
    expect(screen.getByTestId('connector-catalog-empty')).toHaveTextContent('No products found in this store yet.');
  });

  it('shows skeletons while the first page loads and a note while more pages arrive', () => {
    const { rerender } = render(<Harness overrides={{ isLoading: true }} />);
    expect(screen.getByTestId('connector-catalog-loading')).toBeInTheDocument();
    rerender(<Harness overrides={{ isLoadingMore: true }} />);
    expect(screen.getByTestId('connector-selected-count')).toHaveTextContent('loading more');
  });

  it('shows a store photo only from an https address', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://dezentralshop.ch/a.jpg');
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});
