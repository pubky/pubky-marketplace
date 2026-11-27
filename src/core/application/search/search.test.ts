import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NexusSearchService } from '@/services/nexus/search/search';
import { SearchApplication } from './search';

describe('SearchApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchTagsByPrefix', () => {
    it('should call NexusSearchService.tags with correct params', async () => {
      const params = { prefix: 'bit', skip: 0, limit: 5 };
      const mockTags = ['bitcoin', 'bitkit', 'bits'];
      const tagsSpy = vi.spyOn(NexusSearchService, 'tags').mockResolvedValue(mockTags);

      const result = await SearchApplication.fetchTagsByPrefix(params);

      expect(tagsSpy).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockTags);
    });

    it('should return empty array when no tags found', async () => {
      vi.spyOn(NexusSearchService, 'tags').mockResolvedValue([]);

      const result = await SearchApplication.fetchTagsByPrefix({ prefix: 'xyz', skip: 0, limit: 5 });

      expect(result).toEqual([]);
    });

    it('should propagate errors from service', async () => {
      vi.spyOn(NexusSearchService, 'tags').mockRejectedValue(new Error('API error'));

      await expect(SearchApplication.fetchTagsByPrefix({ prefix: 'test', skip: 0, limit: 5 })).rejects.toThrow(
        'API error',
      );
    });
  });
});
