import { beforeEach, describe, expect, it } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { db } from '@/database/franky/franky';
import { MarketplaceTagsModel } from '@/models/marketplace/tags/marketplaceTags';
import type { Pubky } from '@/models/models.types';
import { buildMarketplaceTagRowId, LocalMarketplaceTagService } from '@/services/local/tag/marketplace/tag.marketplace';
import type { TLocalTagParams } from '@/services/local/tag/tag.types';
import type { NexusTag } from '@/services/nexus/nexus.types';

const testData = {
  taggerPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
  anotherTaggerPubky: 'y4euc88xboik1ev3axy9m9ajuedo8gx1mh1n7ms8zoxm5s1b1h9y' as Pubky,
  sellerPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy' as Pubky,
  listingId: '0034A0X7NJ52A',
};

const listingRowId = buildMarketplaceTagRowId(TagKind.LISTING, `${testData.sellerPubky}:${testData.listingId}`);
const shopRowId = buildMarketplaceTagRowId(TagKind.SHOP, testData.sellerPubky);

const createTagParams = (label: string, taggedId: string = listingRowId): TLocalTagParams => ({
  taggedId,
  label,
  taggerId: testData.taggerPubky,
});

const createTagRecord = (label: string, taggers: Pubky[], relationship: boolean): NexusTag => ({
  label,
  taggers,
  taggers_count: taggers.length,
  relationship,
});

describe('LocalMarketplaceTagService', () => {
  beforeEach(async () => {
    await db.initialize();
    await MarketplaceTagsModel.table.clear();
    window.sessionStorage.clear();
  });

  describe('buildMarketplaceTagRowId', () => {
    it('prefixes listing composite ids with the listing kind', () => {
      expect(listingRowId).toBe(`listing:${testData.sellerPubky}:${testData.listingId}`);
    });

    it('prefixes shop owner pubkies with the shop kind', () => {
      expect(shopRowId).toBe(`shop:${testData.sellerPubky}`);
    });
  });

  describe('create', () => {
    it('creates a tag row for a listing target', async () => {
      const mutated = await LocalMarketplaceTagService.create(createTagParams('handmade'));

      expect(mutated).toBe(true);
      const saved = await MarketplaceTagsModel.findById(listingRowId);
      expect(saved?.tags).toHaveLength(1);
      expect(saved?.tags[0]).toMatchObject({
        label: 'handmade',
        taggers: [testData.taggerPubky],
        taggers_count: 1,
        relationship: true,
      });
    });

    it('creates a tag row for a shop target', async () => {
      await LocalMarketplaceTagService.create(createTagParams('trusted', shopRowId));

      const saved = await MarketplaceTagsModel.findById(shopRowId);
      expect(saved?.tags[0]).toMatchObject({ label: 'trusted', relationship: true });
    });

    it('is idempotent when the tagger already has the tag', async () => {
      await LocalMarketplaceTagService.create(createTagParams('handmade'));
      const mutated = await LocalMarketplaceTagService.create(createTagParams('handmade'));

      expect(mutated).toBe(false);
      const saved = await MarketplaceTagsModel.findById(listingRowId);
      expect(saved?.tags[0].taggers_count).toBe(1);
    });
  });

  describe('delete', () => {
    it('removes the viewer from a tag and drops empty tags', async () => {
      await LocalMarketplaceTagService.create(createTagParams('handmade'));

      const deleted = await LocalMarketplaceTagService.delete(createTagParams('handmade'));

      expect(deleted).toBe(true);
      const saved = await MarketplaceTagsModel.findById(listingRowId);
      expect(saved?.tags).toHaveLength(0);
    });

    it('is idempotent when nothing was tagged', async () => {
      const deleted = await LocalMarketplaceTagService.delete(createTagParams('handmade'));
      expect(deleted).toBe(false);
    });
  });

  describe('read', () => {
    it('returns the cached aggregate or an empty array', async () => {
      expect(await LocalMarketplaceTagService.read(listingRowId)).toEqual([]);

      await LocalMarketplaceTagService.create(createTagParams('handmade'));
      const tags = await LocalMarketplaceTagService.read(listingRowId);
      expect(tags).toHaveLength(1);
    });
  });

  describe('mergeTags', () => {
    it('merges Nexus tags into an empty cache', async () => {
      await LocalMarketplaceTagService.mergeTags({
        taggedId: listingRowId,
        tags: [createTagRecord('vintage', [testData.anotherTaggerPubky], false)],
        viewerId: testData.taggerPubky,
      });

      const saved = await MarketplaceTagsModel.findById(listingRowId);
      expect(saved?.tags[0]).toMatchObject({
        label: 'vintage',
        taggers: [testData.anotherTaggerPubky],
        taggers_count: 1,
        relationship: false,
      });
    });

    it('preserves the viewer relationship written locally when a stale Nexus response arrives', async () => {
      // Local write-through sets a viewer marker.
      await LocalMarketplaceTagService.create(createTagParams('handmade'));

      // Nexus does not yet know about the viewer's tag.
      await LocalMarketplaceTagService.mergeTags({
        taggedId: listingRowId,
        tags: [createTagRecord('handmade', [testData.anotherTaggerPubky], false)],
        viewerId: testData.taggerPubky,
      });

      const saved = await MarketplaceTagsModel.findById(listingRowId);
      const tag = saved?.tags.find((t) => t.label === 'handmade');
      expect(tag?.relationship).toBe(true);
      expect(tag?.taggers).toContain(testData.taggerPubky);
      expect(tag?.taggers).toContain(testData.anotherTaggerPubky);
      // Nexus said 1 (only the other tagger); the marker adds the viewer back.
      expect(tag?.taggers_count).toBe(2);
    });

    it('replaces a stale legacy aggregate with a complete nonempty resource page, retaining a pending add', async () => {
      const viewer = testData.taggerPubky;
      const other = testData.anotherTaggerPubky;
      await MarketplaceTagsModel.upsert({
        id: listingRowId,
        tags: [createTagRecord('absent', [other], false), createTagRecord('art', [viewer], true)],
      });
      await LocalMarketplaceTagService.create(createTagParams('pending'));
      await LocalMarketplaceTagService.create(createTagParams('removed'));
      await LocalMarketplaceTagService.delete(createTagParams('removed'));
      // A second tab shares Dexie but has fresh sessionStorage.
      window.sessionStorage.clear();
      await LocalMarketplaceTagService.mergeTags({
        taggedId: listingRowId,
        viewerId: viewer,
        clearMissing: true,
        tags: [createTagRecord('art', [other], false), createTagRecord('removed', [viewer], true)],
      });
      const tags = await LocalMarketplaceTagService.read(listingRowId);
      expect(tags).toEqual(
        expect.arrayContaining([createTagRecord('art', [other], false), createTagRecord('pending', [viewer], true)]),
      );
      expect(tags).toHaveLength(2);
    });

    it('leaves locally-known labels alone when absent from the Nexus response', async () => {
      await LocalMarketplaceTagService.create(createTagParams('handmade'));

      await LocalMarketplaceTagService.mergeTags({
        taggedId: listingRowId,
        tags: [createTagRecord('vintage', [testData.anotherTaggerPubky], false)],
        viewerId: testData.taggerPubky,
      });

      const saved = await MarketplaceTagsModel.findById(listingRowId);
      const labels = saved?.tags.map((t) => t.label).sort();
      expect(labels).toEqual(['handmade', 'vintage']);
    });
  });
});

describe('Marketplace viewer tag addresses', () => {
  const viewer = testData.taggerPubky;
  const id = '01BHZZZZZZZZZZZZZZZZZZZZZZ';
  it('accepts only a tag file below the current viewer’s social root', async () => {
    const row = buildMarketplaceTagRowId(TagKind.LISTING, testData.listingId);
    for (const [url, accepted] of [
      [`pubky://${viewer}/pub/social/v1/tags/${id}.json`, true],
      [`pubky://${viewer}/pub/pubky.app/tags/${id}`, true],
      [`pubky://${testData.anotherTaggerPubky}/pub/social/v1/tags/${id}.json`, false],
      [`pubky://${viewer}/priv/social/v1/tags/${id}.json`, false],
      [`pubky://${viewer}/pub/social/v1/profile.json`, false],
    ] as const) {
      await MarketplaceTagsModel.upsert({
        id: row,
        tags: [{ label: 'art', taggers: [], taggers_count: 1, relationship: true, tag_uri: url }],
      });
      expect(await LocalMarketplaceTagService.getViewerTagUrl(row, 'art', viewer)).toBe(accepted ? url : undefined);
    }
  });
});
