import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS } from '@/config/commerce';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type { NexusReputationSummary } from '@/services/nexus/marketplace/marketplace.types';
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
