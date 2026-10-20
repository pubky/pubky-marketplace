import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  buildMarketplaceCatalogItems,
  type MarketplaceCatalogItem,
} from '@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import type { MarketplaceListingProjection } from '@/services/marketplace/marketplace';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { toCommerceListingModel } from '@/test/fixtures/commerce/listing-models';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceListingCard } from './MarketplaceListingCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => 'transaction-service' };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMarketplaceListingProjection: vi.fn(),
    getIndicativeBtcRate: vi.fn(async () => null),
  },
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

vi.mock('@/hooks/useCommerceFavorite/useCommerceFavorite', () => ({
  useCommerceFavorite: () => ({ isFavorite: false, isMutating: false, toggle: vi.fn() }),
}));

let showCard: (() => void) | null = null;
class MockIntersectionObserver {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    showCard = () => callback([{ isIntersecting: true } as IntersectionObserverEntry]);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

function catalogItem(): MarketplaceCatalogItem {
  const record = createCommerceSandboxCatalog().listings[0];
  return buildMarketplaceCatalogItems([toCommerceListingModel(record)], [])[0];
}

function projection(overrides: Record<string, unknown>): MarketplaceListingProjection {
  return asOpaque<MarketplaceListingProjection>({
    saleFormat: 'fixed_price',
    state: 'available',
    availableQuantity: 1,
    auction: null,
    ...overrides,
  });
}

describe('MarketplaceListingCard after a sale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommerceStore.getState().reset();
    showCard = null;
  });

  it('stops offering Buy now once the controller reports the listing changed and it has sold', async () => {
    const listing = catalogItem();
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(projection({}));
    render(<MarketplaceListingCard listing={listing} shopName="Satoshi Vintage" />);
    act(() => showCard?.());
    await waitFor(() => expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Buy now')).toBeInTheDocument();

    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(
      projection({ state: 'sold', availableQuantity: 0 }),
    );
    act(() => useCommerceStore.getState().refreshListingCards([listing.id]));

    expect(await screen.findByText('Sold out')).toBeInTheDocument();
    expect(screen.queryByText('Buy now')).not.toBeInTheDocument();
  });
});
