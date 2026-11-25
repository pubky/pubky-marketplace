import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { db } from '@/database/franky/franky';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { MarketplaceTagsModel } from '@/models/marketplace/tags/marketplaceTags';
import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import { useAuthStore } from '@/stores/auth/auth.store';
import { type MarketplaceTagTarget, useMarketplaceTags } from './useMarketplaceTags';

const seller = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto';
const listingId = '0034A0X7NJ52A';
const social = 'https://social.example.test';
const market = 'https://market.example.test';
const tag = (label: string) => ({ label, taggers: [], taggers_count: 1, relationship: false });
const targets: { target: MarketplaceTagTarget; rowId: string }[] = [
  { target: { kind: TagKind.LISTING, sellerPubky: seller, listingId }, rowId: `listing:${seller}:${listingId}` },
  { target: { kind: TagKind.SHOP, ownerPubky: seller }, rowId: `shop:${seller}` },
];

describe('community tags on an open Shop page', () => {
  beforeEach(async () => {
    useAuthStore.setState({ currentUserPubky: null, session: null, sessionOwner: null });
    await db.initialize();
    await MarketplaceTagsModel.table.clear();
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', social);
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', market);
    vi.stubEnv('PUBKY_RUNTIME_TTL_RETRY_DELAY_MS', '100');
    resetRuntimeConfigForTests();
  });

  afterEach(() => {
    nexusQueryClient.clear();
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
    vi.restoreAllMocks();
  });

  it.each(targets)(
    'keeps cached $target.kind tags and refreshes them when the social Nexus recovers',
    async ({ target, rowId }) => {
      await MarketplaceTagsModel.upsert({ id: rowId, tags: [tag('cached')] });
      let available = false;
      const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url === `${social}/v1/info`) {
          return available ? Response.json({}) : new Response(null, { status: 503 });
        }
        if (url.startsWith(`${social}/v1/resource/by-uri?`)) return Response.json({ tags: [tag('recovered')] });
        throw new Error(`Unexpected request: ${url}`);
      });
      const { result } = renderHook(() => useMarketplaceTags(target));
      const labels = () => result.current.tags.map(({ label }) => label);
      await waitFor(() => expect(labels()).toEqual(['cached']));
      expect(request.mock.calls.some(([input]) => String(input) === `${social}/v1/info`)).toBe(true);

      available = true;
      await waitFor(() => expect(labels()).toEqual(['recovered']));
      expect(request.mock.calls.some(([input]) => String(input).startsWith(market))).toBe(false);
    },
  );
});
