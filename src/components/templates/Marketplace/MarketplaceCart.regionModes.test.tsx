import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_BLOCKED_MESSAGE, COMMERCE_UNKNOWN_REGION_MESSAGE } from '@/libs/commerce/region-modes';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceCart } from './MarketplaceCart';

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const listing = {
  id: 'seller:boots',
  listing_id: 'boots',
  record: {
    ownerPubky: 's'.repeat(52),
    listingId: 'boots',
    title: 'Vintage boots',
    media: [],
    fulfillmentMethods: ['physical', 'shipping'],
    variants: [{ id: 'variant_42', options: { size: '42' }, quantity: 3 }],
    sale: { format: 'fixed_price', unitPrice: { amountMinor: 1200, currency: 'USD', exponent: 2 } },
  },
};

const view = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/cart',
}));

vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMarketplaceCart/useMarketplaceCart')>();
  return {
    ...actual,
    useMarketplaceCart: () => {
      const items = view.items as never[];
      return {
        items,
        ordinaryItems: items,
        awardItems: [],
        itemCount: items.length,
        subtotals: [],
        isLoading: false,
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        groups: actual.groupMarketplaceCartItems(items),
      };
    },
  };
});

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({ offers: [], isLoading: false, error: null, needsSession: false }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary', () => ({
  useMarketplaceSellerSummary: () => ({
    shop: null,
    reputation: { status: 'new_seller' },
    displayName: 'Satoshi Vintage',
  }),
}));

const checkout = () => screen.getByTestId('marketplace-cart-checkout');

beforeEach(() => {
  resetRegionState();
  view.items = [
    { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
  ];
});
afterEach(() => resetRegionState());

describe('MarketplaceCart under the region modes', () => {
  it('replaces Checkout with a disabled button and the one line in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    render(<MarketplaceCart />);

    expect(await screen.findByTestId('marketplace-cart-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(checkout()).toBeDisabled();
    expect(checkout().closest('a')).toBeNull();
    expect(screen.getByRole('button', { name: 'About this limit' })).toBeInTheDocument();
    expect(screen.getByText('Vintage boots')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /authorize|enable purchases/i })).not.toBeInTheDocument();
  });

  it('says the location cannot be told for an unknown visitor', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    render(<MarketplaceCart />);

    expect(await screen.findByTestId('marketplace-cart-blocked')).toHaveTextContent(COMMERCE_UNKNOWN_REGION_MESSAGE);
    expect(checkout()).toBeDisabled();
  });

  it('keeps Checkout off, with no line, while the visitor region is being read', () => {
    setRegionModes(LAUNCH);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<MarketplaceCart />);

    expect(checkout()).toBeDisabled();
    expect(screen.queryByTestId('marketplace-cart-blocked')).not.toBeInTheDocument();
  });

  it('keeps Checkout as a link for a visitor from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    render(<MarketplaceCart />);

    await waitFor(() => expect(checkout().closest('a')).not.toBeNull());
    expect(screen.queryByTestId('marketplace-cart-blocked')).not.toBeInTheDocument();
  });

  it('is unchanged, and reads no region, while no region is blocked', () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    render(<MarketplaceCart />);

    expect(checkout().closest('a')).not.toBeNull();
    expect(screen.queryByTestId('marketplace-cart-blocked')).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
