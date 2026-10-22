import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import type { MarketplaceOffer } from '@/services/marketplace/marketplace';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceOffers } from './MarketplaceOffers';

const ME = 'b'.repeat(52);
const OTHER = 's'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const view = vi.hoisted(() => ({ offers: [] as MarketplaceOffer[] }));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getManyListings: vi.fn(async () => new Map()),
    getIndicativeBtcRate: vi.fn(async () => null),
    getOrFetchListing: vi.fn(async () => null),
    getMarketplaceOrder: vi.fn(async () => ({ state: 'cancelled' })),
  },
}));
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', () => ({
  useMarketplaceFirstMediaUrl: (uris: readonly string[]) => uris[0] ?? null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/offers',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: ME }),
}));
vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({
    offers: view.offers,
    isLoading: false,
    error: null,
    needsSession: false,
    refresh: vi.fn(async () => {}),
    form: {},
    act: vi.fn(async () => false),
    counter: vi.fn(async () => false),
  }),
}));
vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', () => ({
  useMarketplaceCart: () => ({ addAward: vi.fn(async () => true) }),
}));
vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({ useMarketplaceCartCount: () => 0 }));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const base = {
  id: '018f47d2-6a27-7c23-b51e-000000000001',
  aggregateId: 'offer:018f47d2-6a27-7c23-b51e-000000000002',
  listingAggregateId: `listing:${OTHER}_boots`,
  revision: 1,
  amount: { amountMinor: 1000, currency: 'USD', exponent: 2 },
  quantity: 1,
  message: '',
  expiresAt: '2099-09-13T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};

const incoming = {
  ...base,
  buyerPubky: OTHER,
  sellerPubky: ME,
  offeredBy: OTHER,
  state: 'pending',
} as MarketplaceOffer;

const accepted = {
  ...base,
  buyerPubky: ME,
  sellerPubky: OTHER,
  offeredBy: ME,
  state: 'accepted',
  award: {
    id: '00000000-0000-4000-8000-000000000801',
    state: 'active',
    listing: {
      aggregateId: base.listingAggregateId,
      sellerPubky: OTHER,
      listingId: 'boots',
      title: 'Vintage boots',
      listingRevision: 2,
      listingRecordSha256: 'a'.repeat(64),
    },
    variant: { id: 'variant_42', sku: null, options: [] },
    unitPrice: { amountMinor: 600, currency: 'USD', exponent: 2 },
    quantity: 1,
    acceptedAt: '2026-09-15T10:00:00.000Z',
    convertBy: '2099-09-15T12:00:00.000Z',
    convertedOrderId: null,
    subtotal: { amountMinor: 600, currency: 'USD', exponent: 2 },
    shipping: { amountMinor: 100, currency: 'USD', exponent: 2 },
    merchandiseTotal: { amountMinor: 700, currency: 'USD', exponent: 2 },
    fulfillmentMethods: ['shipping'],
  },
} as MarketplaceOffer;

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('MarketplaceOffers under the region modes', () => {
  it('disables Accept and Counter, and says why, in a blocked region, but still lets a seller decline', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    view.offers = [incoming];
    render(<MarketplaceOffers />);

    expect(await screen.findByTestId('marketplace-offers-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Counter' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('disables the buyer’s Buy on an accepted offer in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    view.offers = [accepted];
    render(<MarketplaceOffers />);

    await screen.findByTestId('marketplace-offers-blocked');
    expect(screen.getByRole('button', { name: /Buy for/ })).toBeDisabled();
  });

  it('leaves the buttons on for a visitor from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    view.offers = [incoming];
    render(<MarketplaceOffers />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Counter' })).toBeEnabled();
    expect(screen.queryByTestId('marketplace-offers-blocked')).not.toBeInTheDocument();
  });

  it('is unchanged, and reads no region, while no region is blocked', () => {
    setRegionModes('none');
    const fetchStub = stubClientRegion('US');
    view.offers = [incoming];
    render(<MarketplaceOffers />);

    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
