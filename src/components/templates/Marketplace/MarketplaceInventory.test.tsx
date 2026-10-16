import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getMarketplaceListingRoute } from '@/app/routes';
import type { InventoryBoardLoad, InventoryBoardRow } from '@/application/commerce/inventory';
import { MarketplaceInventory } from './MarketplaceInventory';

const seller = 'y'.repeat(52);

function row(overrides: Partial<InventoryBoardRow> = {}): InventoryBoardRow {
  return {
    listingId: 'guide',
    sellerPubky: seller,
    aggregateId: `listing:${seller}_guide`,
    title: 'Printable field guide',
    thumbUrl: null,
    state: 'available',
    listingState: 'active',
    format: 'fixed_price',
    dropId: null,
    available: 999_999,
    reserved: 1,
    sold: 0,
    total: 1_000_000,
    serverRevision: 3,
    unlimited: true,
    sync: 'synced',
    ...overrides,
  };
}

const view = vi.hoisted(() => ({
  load: { status: 'ready', rows: [] } as InventoryBoardLoad,
  relist: vi.fn(async () => true),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/marketplace/inventory',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/hooks/useMarketplaceInventory/useMarketplaceInventory', () => ({
  useMarketplaceInventory: () => ({
    sellerPubky: seller,
    isLoading: false,
    load: view.load,
    conflictListingId: null,
    pendingListingId: null,
    refresh: vi.fn(),
    setAvailable: vi.fn(),
    retrySync: vi.fn(),
    relist: view.relist,
  }),
}));

vi.mock('@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport', () => ({
  useMarketplaceInventoryImport: () => ({ reset: vi.fn(), submitStoreUrl: vi.fn(), storeForm: { control: {} } }),
}));

describe('MarketplaceInventory', () => {
  it('reads Unlimited for an unlimited listing while a hold has lowered available', () => {
    view.load = { status: 'ready', rows: [row()] };
    render(<MarketplaceInventory />);
    const stock = screen.getByTestId('inventory-stock-guide');
    expect(stock).toHaveTextContent('Unlimited');
    expect(stock).toHaveTextContent('1 reserved');
    expect(stock).not.toHaveTextContent('999999');
    expect(stock).not.toHaveTextContent('1000000');
  });

  it('reads a number of copies for a finite listing', () => {
    view.load = {
      status: 'ready',
      rows: [
        row({ listingId: 'boots', title: 'Boots', available: 4, reserved: 1, sold: 2, total: 7, unlimited: undefined }),
      ],
    };
    render(<MarketplaceInventory />);
    const stock = screen.getByTestId('inventory-stock-boots');
    expect(stock).toHaveTextContent('4');
    expect(stock).toHaveTextContent('7 total');
    expect(stock).not.toHaveTextContent('Unlimited');
  });

  it('reads paused, not the stock state, and offers Relist for a paused listing', () => {
    view.relist.mockClear();
    const paused = row({ listingId: 'boots', title: 'Boots', state: 'available', listingState: 'paused' });
    view.load = { status: 'ready', rows: [paused] };
    render(<MarketplaceInventory />);

    expect(screen.getByTestId('inventory-state-boots')).toHaveTextContent('paused');
    expect(screen.getByRole('button', { name: 'Set stock' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Relist' }));
    expect(view.relist).toHaveBeenCalledWith(paused);
  });

  it('offers no Relist for an active listing or a paused auction', () => {
    view.load = {
      status: 'ready',
      rows: [
        row({ listingId: 'boots', title: 'Boots', listingState: 'active' }),
        row({ listingId: 'lamp', title: 'Lamp', listingState: 'paused', format: 'auction' }),
      ],
    };
    render(<MarketplaceInventory />);

    expect(screen.getByTestId('inventory-state-boots')).toHaveTextContent('active');
    expect(screen.queryByRole('button', { name: 'Relist' })).not.toBeInTheDocument();
  });

  it('falls back to the stock state when the export carries no record', () => {
    view.load = { status: 'ready', rows: [row({ listingId: 'boots', state: 'available', listingState: null })] };
    render(<MarketplaceInventory />);

    expect(screen.getByTestId('inventory-state-boots')).toHaveTextContent('available');
  });

  it('links the title to the listing page', () => {
    view.load = { status: 'ready', rows: [row({ listingId: 'boots', title: 'Boots' })] };
    render(<MarketplaceInventory />);

    expect(screen.getByRole('link', { name: 'Boots' })).toHaveAttribute(
      'href',
      getMarketplaceListingRoute(seller, 'boots'),
    );
  });
});
