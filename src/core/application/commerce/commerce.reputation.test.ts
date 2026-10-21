import { afterEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import { MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS } from '@/config/commerce';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type { NexusReputationBucket, NexusReputationSummary } from '@/services/nexus/marketplace/marketplace.types';
import { COMMERCE_FIXTURE_SELLER, createNexusListingDetailsFixture } from '@/test/fixtures/commerce/commerce';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { CommerceApplication } from './commerce';

const SELLER = 's'.repeat(52);
const window = (entry: { pubky: string; validFrom: string }) => `${entry.pubky}:${Date.parse(entry.validFrom) / 1000}:`;
const PRODUCTION_WINDOW = window(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS[0]);

const SUMMARY: NexusReputationSummary = {
  count: 2,
  verified_count: 2,
  avg: 4.5,
  histogram: [0, 0, 0, 1, 1],
  avg_item_accuracy: null,
  avg_shipping: null,
  avg_communication: null,
  response_count: 0,
  edited_late_count: 0,
  attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 2 },
  last_reviewed_at: null,
};

describe('CommerceApplication.fetchSellerReputationOverview', () => {
  const envName = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
  const suiteValue = process.env[envName];

  afterEach(() => {
    vi.restoreAllMocks();
    process.env[envName] = suiteValue;
    resetRuntimeConfigForTests();
  });

  it('requests the exact counted figure for the effective trust windows', async () => {
    const fetch = vi.spyOn(NexusMarketplaceService, 'fetchShopReputation').mockResolvedValue({
      ...SUMMARY,
      buckets: {},
      unverified_count: 0,
      scoped: {
        orders: 2,
        buyers: 1,
        sum_buyer_means: 4.5,
        weighted_sum: 4.5,
        weight_total: 1,
        histogram: [0, 0, 0, 1, 1],
        first_iat: 1_772_323_200,
        last_iat: 1_788_220_800,
        seller_buyers: 1,
        sum_seller_buyer_means: 4,
      },
    });

    const overview = await CommerceApplication.fetchSellerReputationOverview(SELLER);

    expect(fetch).toHaveBeenCalledWith({
      seller_id: SELLER,
      attestors: `${PRODUCTION_WINDOW},${window(TEST_TRUSTED_ATTESTOR)}`,
    });
    expect(overview).toMatchObject({ status: 'rated', summary: { scoped: { buyers: 1, sellerBuyers: 1 } } });
  });

  it('sends only the compiled production window when the deployment adds no attestors', async () => {
    process.env[envName] = '[]';
    resetRuntimeConfigForTests();
    const fetch = vi.spyOn(NexusMarketplaceService, 'fetchShopReputation').mockResolvedValue(SUMMARY);

    await CommerceApplication.fetchSellerReputationOverview(SELLER);

    expect(fetch).toHaveBeenCalledWith({ seller_id: SELLER, attestors: PRODUCTION_WINDOW });
  });

  it('reads an older index that ignores the parameter as a summary without counted figures', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchShopReputation').mockResolvedValue(SUMMARY);

    const overview = await CommerceApplication.fetchSellerReputationOverview(SELLER);

    expect(overview).toEqual({ status: 'rated', summary: expect.objectContaining({ count: 2, avg: 4.5 }) });
    expect(Object.keys((overview as { summary: object }).summary)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(buckets|scoped)$/)]),
    );
  });
});

describe('CommerceApplication.fetchListingRating', () => {
  const SCOPED: NexusReputationBucket = {
    orders: 3,
    buyers: 2,
    sum_buyer_means: 9,
    weighted_sum: 13,
    weight_total: 3,
    histogram: [0, 0, 0, 1, 2],
    first_iat: 1_788_220_800,
    last_iat: 1_788_825_600,
  };
  const SNIPPET = { avg: 4.2, count: 5, verified_count: 4 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the trust windows and carries the index's exact listing figure on the snippet", async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    const fetch = vi.spyOn(NexusMarketplaceService, 'fetchListingDetailsOnce').mockResolvedValue({
      ...createNexusListingDetailsFixture({ listing_reputation: SNIPPET }),
      scoped_listing_reputation: SCOPED,
    });

    const rating = await CommerceApplication.fetchListingRating(COMMERCE_FIXTURE_SELLER, 'boots_01');

    expect(fetch).toHaveBeenCalledWith({
      seller_id: COMMERCE_FIXTURE_SELLER,
      listing_id: 'boots_01',
      attestors: `${PRODUCTION_WINDOW},${window(TEST_TRUSTED_ATTESTOR)}`,
    });
    expect(rating).toMatchObject({ avg: 4.2, count: 5, scoped: { buyers: 2, orders: 3, sumBuyerMeans: 9 } });
  });

  it('reads an older index that ignores the parameter as a snippet without a scoped figure', async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    vi.spyOn(NexusMarketplaceService, 'fetchListingDetailsOnce').mockResolvedValue(
      createNexusListingDetailsFixture({ listing_reputation: SNIPPET }),
    );

    const rating = await CommerceApplication.fetchListingRating(COMMERCE_FIXTURE_SELLER, 'boots_01');

    expect(rating).toMatchObject({ avg: 4.2, count: 5 });
    expect(rating).not.toHaveProperty('scoped');
  });

  it('keeps a listing without reviews unrated even when a scoped figure arrives', async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    vi.spyOn(NexusMarketplaceService, 'fetchListingDetailsOnce').mockResolvedValue({
      ...createNexusListingDetailsFixture(),
      scoped_listing_reputation: SCOPED,
    });

    expect(await CommerceApplication.fetchListingRating(COMMERCE_FIXTURE_SELLER, 'boots_01')).toBeNull();
  });
});
