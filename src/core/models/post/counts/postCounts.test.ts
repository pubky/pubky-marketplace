import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '@/database/franky/franky.helpers';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import type { NexusModelTuple } from '@/models/shared/base/tuple/baseTuple.type';
import type { NexusPostCounts } from '@/services/nexus/nexus.types';

describe('PostCountsModel', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const testPostId1 = 'post-test-1';
  const testPostId2 = 'post-test-2';

  const MOCK_NEXUS_POST_COUNTS: NexusPostCounts = {
    tags: 5,
    unique_tags: 3,
    replies: 12,
    reposts: 8,
  };

  describe('Constructor', () => {
    it('should create PostCountsModel instance with all properties', () => {
      const mockPostCountsData = { id: testPostId1, ...MOCK_NEXUS_POST_COUNTS };
      const postCounts = new PostCountsModel(mockPostCountsData);

      expect(postCounts.id).toBe(testPostId1);
      expect(postCounts.tags).toBe(5);
      expect(postCounts.unique_tags).toBe(3);
      expect(postCounts.replies).toBe(12);
      expect(postCounts.reposts).toBe(8);
    });
  });

  describe('Static Methods', () => {
    const createTestPostCounts = (id: string) => ({ id, ...MOCK_NEXUS_POST_COUNTS });

    it('should create post counts', async () => {
      const result = await PostCountsModel.create(createTestPostCounts(testPostId1));
      expect(result).toBe(testPostId1);
    });

    it('should find post counts by id', async () => {
      await PostCountsModel.create(createTestPostCounts(testPostId1));
      const result = await PostCountsModel.findById(testPostId1);

      expect(result).toBeInstanceOf(PostCountsModel);
      expect(result!.id).toBe(testPostId1);
      expect(result!.replies).toBe(12);
    });

    it('should return null for non-existent post counts', async () => {
      const nonExistentId = 'non-existent-post-999';
      const result = await PostCountsModel.findById(nonExistentId);
      expect(result).toBeNull();
    });

    it('should bulk save post counts from tuples', async () => {
      const mockNexusModelTuples: NexusModelTuple<NexusPostCounts>[] = [
        [testPostId1, MOCK_NEXUS_POST_COUNTS],
        [testPostId2, { ...MOCK_NEXUS_POST_COUNTS, replies: 25 }],
      ];

      await PostCountsModel.bulkSave(mockNexusModelTuples);

      const postCounts1 = await PostCountsModel.findById(testPostId1);
      const postCounts2 = await PostCountsModel.findById(testPostId2);

      expect(postCounts1!.replies).toBe(12);
      expect(postCounts2!.replies).toBe(25);
    });

    it('should handle empty array in bulk save', async () => {
      const result = await PostCountsModel.bulkSave([]);
      // bulkPut with empty array returns undefined, which is expected
      expect(result).toBeUndefined();
    });

    it('should handle multiple tuples with different data', async () => {
      const mockTuples: NexusModelTuple<NexusPostCounts>[] = [
        [testPostId1, MOCK_NEXUS_POST_COUNTS],
        [testPostId2, { ...MOCK_NEXUS_POST_COUNTS, reposts: 100, tags: 1 }],
      ];

      await PostCountsModel.bulkSave(mockTuples);

      const postCounts1 = await PostCountsModel.findById(testPostId1);
      const postCounts2 = await PostCountsModel.findById(testPostId2);

      expect(postCounts1!.reposts).toBe(8);
      expect(postCounts1!.tags).toBe(5);
      expect(postCounts2!.reposts).toBe(100);
      expect(postCounts2!.tags).toBe(1);
    });

    describe('toSchema', () => {
      it('should convert NexusModelTuple to PostCountsModelSchema', () => {
        const tuple: NexusModelTuple<NexusPostCounts> = [testPostId1, MOCK_NEXUS_POST_COUNTS];
        const result = PostCountsModel.toSchema(tuple);

        expect(result).toEqual({
          id: testPostId1,
          tags: MOCK_NEXUS_POST_COUNTS.tags,
          unique_tags: MOCK_NEXUS_POST_COUNTS.unique_tags,
          replies: MOCK_NEXUS_POST_COUNTS.replies,
          reposts: MOCK_NEXUS_POST_COUNTS.reposts,
        });
      });

      it('should handle different post IDs in toSchema', () => {
        const tuple: NexusModelTuple<NexusPostCounts> = [testPostId2, MOCK_NEXUS_POST_COUNTS];
        const result = PostCountsModel.toSchema(tuple);

        expect(result.id).toBe(testPostId2);
        expect(result).toEqual({ id: testPostId2, ...MOCK_NEXUS_POST_COUNTS });
      });
    });
  });
});
