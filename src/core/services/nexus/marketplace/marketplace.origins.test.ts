import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import { NexusMarketplaceService } from './marketplace';

const social = 'https://social.example.test';
const market = 'https://market.example.test';
const seller = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto';
const shop = { seller_id: seller };
const listing = { ...shop, listing_id: 'boots' };

describe('Market reads with separate social and commerce indexes', () => {
  beforeEach(() => {
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', social);
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', market);
    resetRuntimeConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
    nexusQueryClient.clear();
    vi.restoreAllMocks();
  });

  it('probes and reads v1 tags on the social index while listing and shop data stay on the commerce index', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({}))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ tags: [] }));
    await NexusMarketplaceService.fetchListingTags(listing);
    await NexusMarketplaceService.fetchListingDetailsOnce(listing);
    await NexusMarketplaceService.fetchShopReputation(shop);

    expect(fetch.mock.calls.map(([url]) => String(url).split('?')[0])).toEqual([
      `${social}/v1/info`,
      `${social}/v1/resource/by-uri`,
      `${market}/v0/listing/${seller}/boots`,
      `${market}/v0/shop/${seller}/reputation`,
    ]);
  });

  it('uses the commerce index for both legacy tag projections when the social index lacks v1', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await NexusMarketplaceService.fetchListingTags(listing);
    await NexusMarketplaceService.fetchShopTags(shop);

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${social}/v1/info`,
      `${market}/v0/listing/${seller}/boots/tags`,
      `${market}/v0/shop/${seller}/tags`,
    ]);
  });
});
