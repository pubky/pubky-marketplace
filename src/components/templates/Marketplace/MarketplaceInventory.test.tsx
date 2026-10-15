import { fireEvent, render, screen, within } from '@testing-library/react';
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
  setAvailable: vi.fn(async () => ({ status: 'updated' })),
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
    setAvailable: view.setAvailable,
    retrySync: vi.fn(),
    relist: view.relist,
  }),
}));

vi.mock('@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport', () => ({
  useMarketplaceInventoryImport: () => ({ reset: vi.fn() }),
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
  describe('per-size listings', () => {
    const sized = () =>
      row({
        listingId: 'boots',
        title: 'Boots',
        unlimited: undefined,
        available: 3,
        reserved: 2,
        sold: 0,
        total: 5,
        variants: [
          {
            variantId: 'size_s',
            label: 'S',
            enabled: true,
            available: 0,
            reserved: 1,
            sold: 0,
            total: 1,
            soldOut: true,
          },
          {
            variantId: 'size_m',
            label: 'M',
            enabled: true,
            available: 3,
            reserved: 1,
            sold: 0,
            total: 4,
            soldOut: false,
          },
          {
            variantId: 'size_x',
            label: 'XL',
            enabled: false,
            available: 0,
            reserved: 0,
            sold: 2,
            total: 2,
            soldOut: true,
          },
        ],
      });

    it('shows one row per size with its own counts', () => {
      view.load = { status: 'ready', rows: [sized()] };
      render(<MarketplaceInventory />);

      expect(screen.getByTestId('inventory-size-stock-size_m')).toHaveTextContent(
        '3 avail · 1 reserved · 0 sold · 4 total',
      );
      expect(within(screen.getByTestId('inventory-size-boots-size_s')).getByText('Sold out')).toBeInTheDocument();
      expect(within(screen.getByTestId('inventory-size-boots-size_x')).getByText('Withdrawn')).toBeInTheDocument();
    });

    it('offers Set stock per size, not for the listing, and none for a withdrawn size', () => {
      view.load = { status: 'ready', rows: [sized()] };
      render(<MarketplaceInventory />);

      expect(screen.queryByRole('button', { name: 'Set stock' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set stock for Boots, M' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set stock for Boots, S' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Set stock for Boots, XL' })).not.toBeInTheDocument();
    });

    it('sets the stock of one size and sends that size', () => {
      view.setAvailable.mockClear();
      const listing = sized();
      view.load = { status: 'ready', rows: [listing] };
      render(<MarketplaceInventory />);

      fireEvent.click(screen.getByRole('button', { name: 'Set stock for Boots, M' }));
      const input = screen.getByRole('spinbutton', { name: 'Available quantity' });
      expect(input).toHaveValue(3);
      fireEvent.change(input, { target: { value: '6' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(view.setAvailable).toHaveBeenCalledWith(listing, 6, 'size_m');
    });

    it('keeps a single-variant listing as one row with the old Set stock button', () => {
      view.setAvailable.mockClear();
      const listing = row({ listingId: 'boots', title: 'Boots', unlimited: undefined, available: 4 });
      view.load = { status: 'ready', rows: [listing] };
      render(<MarketplaceInventory />);

      expect(screen.queryByTestId(/inventory-size-/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Set stock' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(view.setAvailable).toHaveBeenCalledWith(listing, 4, undefined);
    });
  });
});
