import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { NexusSearchService } from './search';

vi.mock('@/services/nexus/nexus.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/nexus/nexus.utils')>();
  return {
    ...actual,
    queryNexus: vi.fn(),
  };
});

const mockQueryNexus = vi.mocked(queryNexus);

describe('NexusSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tags', () => {
    it('should call queryNexus with correct URL and return tags', async () => {
      const mockTags = ['bitcoin', 'bitkit', 'bits'];
      const queryNexusSpy = mockQueryNexus.mockResolvedValue(mockTags);

      const result = await NexusSearchService.tags({ prefix: 'bit', skip: 0, limit: 5 });

      expect(queryNexusSpy).toHaveBeenCalledWith({
        url: expect.stringContaining('/v0/search/tags/by_prefix/bit'),
      });
      expect(result).toEqual(mockTags);
    });

    it('should return empty array when queryNexus returns empty array', async () => {
      mockQueryNexus.mockResolvedValue([]);

      const result = await NexusSearchService.tags({ prefix: 'xyz', skip: 0, limit: 5 });

      expect(result).toEqual([]);
    });

    it('should handle special characters in prefix', async () => {
      const queryNexusSpy = mockQueryNexus.mockResolvedValue([]);

      await NexusSearchService.tags({ prefix: 'tag#123', skip: 0, limit: 5 });

      expect(queryNexusSpy).toHaveBeenCalledWith({
        url: expect.stringContaining('tag%23123'),
      });
    });
  });
});
