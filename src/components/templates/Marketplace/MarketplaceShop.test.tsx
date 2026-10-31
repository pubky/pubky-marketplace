import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  COMMERCE_FIXTURE_BUYER,
  COMMERCE_FIXTURE_SELLER,
  createCommerceCatalogEntryFixture,
  createCommerceListingFixture,
  createCommerceShopFixture,
} from '@/test/fixtures/commerce/commerce';
import { MarketplaceShop } from './MarketplaceShop';

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/hooks/useCommerceShopFollow/useCommerceShopFollow', () => ({
  useCommerceShopFollow: () => ({ isFollowing: false, isMutating: false, isLoading: false, toggle: vi.fn() }),
}));
vi.mock('@/hooks/useSellerPaymentBadges/useSellerPaymentBadges', () => ({ useSellerPaymentBadges: () => [] }));
vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useMarketplaceReviews: () => ({ filterSummary: null }),
}));
vi.mock('@/hooks/useLiveSellerShop/useLiveSellerShop', () => ({ useLiveSellerShop: () => true }));
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', () => ({ useMarketplaceMediaUrl: () => undefined }));
vi.mock('@/hooks/useSellingAvailability/useSellingAvailability', () => ({
  useSellingAvailability: () => ({ held: false, sellingMessage: null }),
}));
vi.mock('@/organisms/Marketplace/MarketplaceReviewsSection', () => ({ MarketplaceReviewsSection: () => null }));
vi.mock('@/organisms/Marketplace/MarketplaceReputationHeader', () => ({ MarketplaceReputationHeader: () => null }));
vi.mock('@/organisms/Marketplace/MarketplaceCommunityTags', () => ({ MarketplaceCommunityTags: () => null }));
vi.mock('@/organisms/Marketplace/MarketplaceListingCard', () => ({
  MarketplaceListingCard: ({ listing }: { listing: { title: string } }) => (
    <article data-testid="shop-listing-card">{listing.title}</article>
  ),
}));

const asWire = (record: CommerceListingRecord): Record<string, unknown> => JSON.parse(JSON.stringify(record));

const active = createCommerceListingFixture({ listingId: 'boots_01', title: 'Vintage leather boots' });
const paused = createCommerceListingFixture({ listingId: 'watch_01', state: 'paused', title: 'Paused watch' });

function listingCount(): string | null {
  const label = screen.getByText('Listings');
  return label.previousElementSibling?.textContent ?? null;
}

describe('MarketplaceShop storefront grid', () => {
  beforeEach(async () => {
    useAuthStore.setState({ currentUserPubky: COMMERCE_FIXTURE_BUYER });
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    // The index answers the seller's active listings only; nothing else comes from Nexus.
    vi.spyOn(CommerceController, 'fetchSellerCatalogListings').mockResolvedValue(undefined);
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockImplementation(async (url: string) => ({
      found: true,
      json: asWire(url.endsWith('/watch_01') ? paused : active),
    }));
    await LocalCommerceService.upsertShop(createCommerceShopFixture(), 'synced');
    await LocalCommerceService.bulkUpsertCatalogEntries([createCommerceCatalogEntryFixture()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves out a paused listing whose record a review summary fetched, and does not count it', async () => {
    // The reviews section reads a reviewed listing's record this way, so it shows
    // even when paused; the read caches the record for the seller.
    await expect(
      CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, 'watch_01'),
    ).resolves.toMatchObject({ state: 'paused' });

    render(<MarketplaceShop sellerPubky={COMMERCE_FIXTURE_SELLER} />);

    await waitFor(() => expect(screen.getAllByTestId('shop-listing-card')).toHaveLength(1));
    expect(screen.getByTestId('shop-listing-card')).toHaveTextContent('Vintage leather boots');
    expect(screen.queryByText('Paused watch')).not.toBeInTheDocument();
    expect(listingCount()).toBe('1');
  });

  it('shows the empty storefront when every cached listing is paused', async () => {
    await CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, 'watch_01');
    const entry = createCommerceCatalogEntryFixture({ state: 'paused', revision: 2 });
    await LocalCommerceService.bulkUpsertCatalogEntries([entry]);

    render(<MarketplaceShop sellerPubky={COMMERCE_FIXTURE_SELLER} />);

    await waitFor(() => expect(screen.getByText('No listings from this seller yet')).toBeInTheDocument());
    expect(screen.queryByTestId('shop-listing-card')).not.toBeInTheDocument();
    expect(listingCount()).toBe('0');
  });
});
