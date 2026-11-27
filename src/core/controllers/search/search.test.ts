import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchApplication } from '@/application/search/search';
import { SearchController } from './search';

describe('SearchController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTagsByPrefix', () => {
    it('should call SearchApplication.fetchTagsByPrefix with correct params', async () => {
      const params = { prefix: 'bit', skip: 0, limit: 5 };
      const mockTags = ['bitcoin', 'bitkit', 'bits'];
      const tagsSpy = vi.spyOn(SearchApplication, 'fetchTagsByPrefix').mockResolvedValue(mockTags);

      const result = await SearchController.getTagsByPrefix(params);

      expect(tagsSpy).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockTags);
    });

    it('should return empty array when no tags found', async () => {
      vi.spyOn(SearchApplication, 'fetchTagsByPrefix').mockResolvedValue([]);

      const result = await SearchController.getTagsByPrefix({ prefix: 'xyz', skip: 0, limit: 5 });

      expect(result).toEqual([]);
    });

    it('should propagate errors from application layer', async () => {
      vi.spyOn(SearchApplication, 'fetchTagsByPrefix').mockRejectedValue(new Error('API error'));

      await expect(SearchController.getTagsByPrefix({ prefix: 'test', skip: 0, limit: 5 })).rejects.toThrow(
        'API error',
      );
    });
  });
});
