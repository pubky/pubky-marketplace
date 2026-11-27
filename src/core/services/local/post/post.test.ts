import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import type { Pubky } from '@/models/models.types';
import { buildCompositeId } from '@/models/models.utils';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { LocalPostService } from '@/services/local/post/post';

const testData = {
  authorPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy' as Pubky,
  postId1: 'abc123xyz',
  get fullPostId1() {
    return buildCompositeId({ pubky: this.authorPubky, id: this.postId1 });
  },
};

describe('LocalPostService', () => {
  beforeEach(async () => {
    await db.initialize();
    await PostCountsModel.table.clear();
  });

  describe('readCounts', () => {
    it('should return post counts when post exists', async () => {
      const postId = testData.fullPostId1;
      await PostCountsModel.table.add({
        id: postId,
        tags: 5,
        unique_tags: 3,
        replies: 10,
        reposts: 2,
      });

      const counts = await LocalPostService.readCounts(postId);

      expect(counts).toBeTruthy();
      expect(counts!.id).toBe(postId);
      expect(counts!.tags).toBe(5);
      expect(counts!.unique_tags).toBe(3);
      expect(counts!.replies).toBe(10);
      expect(counts!.reposts).toBe(2);
    });

    it('should return null when post does not exist', async () => {
      const nonExistentPostId = 'nonexistent:post123';

      const counts = await LocalPostService.readCounts(nonExistentPostId);

      expect(counts).toBeNull();
    });

    it('should propagate model errors on database failure', async () => {
      const postId = testData.fullPostId1;

      // Mock findById to throw an error - model layer handles error wrapping
      const spy = vi.spyOn(PostCountsModel, 'findById').mockRejectedValueOnce(new Error('Database connection lost'));

      // Service is pass-through, error bubbles up from model
      await expect(LocalPostService.readCounts(postId)).rejects.toThrow('Database connection lost');

      spy.mockRestore();
    });
  });
});
