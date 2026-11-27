import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserDetailsModel } from '@/models/user/details/userDetails';
import { UserRelationshipsModel } from '@/models/user/relationships/userRelationships';
import type { UserRelationshipsModelSchema } from '@/models/user/relationships/userRelationships.schema';
import { UserTtlModel } from '@/models/user/ttl/userTtl';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';
import { LocalUserService } from './user';

describe('LocalUserService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await UserDetailsModel.table.clear();
    await UserRelationshipsModel.table.clear();
    await UserCountsModel.table.clear();
    await UserTtlModel.table.clear();
  });

  describe('readDetails', () => {
    const userId = 'test-user-id' as Pubky;

    it('should return user details from local database when found', async () => {
      const mockUserDetails: NexusUserDetails = {
        id: userId,
        name: 'Test User',
        bio: 'Test bio',
        image: 'https://example.com/avatar.jpg',
        status: 'active',
        links: [{ title: 'Website', url: 'https://example.com' }],
        indexed_at: Date.now(),
      };

      await UserDetailsModel.create(mockUserDetails);

      const result = await LocalUserService.readDetails({ userId });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(userId);
      expect(result!.name).toBe('Test User');
      expect(result!.bio).toBe('Test bio');
      expect(result!.image).toBe('https://example.com/avatar.jpg');
      expect(result!.status).toBe('active');
      expect(result!.links).toEqual([{ title: 'Website', url: 'https://example.com' }]);
    });

    it('should return null when user not found in local database', async () => {
      const result = await LocalUserService.readDetails({ userId });

      expect(result).toBeNull();
    });

    it('should handle user with minimal fields', async () => {
      const minimalUserDetails: NexusUserDetails = {
        id: userId,
        name: 'Minimal User',
        bio: '',
        image: null,
        status: null,
        links: null,
        indexed_at: Date.now(),
      };

      await UserDetailsModel.create(minimalUserDetails);

      const result = await LocalUserService.readDetails({ userId });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(userId);
      expect(result!.name).toBe('Minimal User');
      expect(result!.bio).toBe('');
      expect(result!.image).toBeNull();
      expect(result!.status).toBeNull();
      expect(result!.links).toBeNull();
    });
  });

  describe('readRelationships', () => {
    const userId = 'test-user-id' as Pubky;

    it('should return user relationships from local database when found', async () => {
      const mockRelationships: UserRelationshipsModelSchema = {
        id: userId,
        following: true,
        followed_by: true,
      };

      await UserRelationshipsModel.create(mockRelationships);

      const result = await LocalUserService.readRelationships({ userId });

      expect(result).not.toBeNull();
      expect(result!.following).toBe(true);
      expect(result!.followed_by).toBe(true);
    });

    it('should return null when user relationships not found in local database', async () => {
      const result = await LocalUserService.readRelationships({ userId });

      expect(result).toBeNull();
    });

    it('should handle user with all false relationships', async () => {
      const emptyRelationships: UserRelationshipsModelSchema = {
        id: userId,
        following: false,
        followed_by: false,
      };

      await UserRelationshipsModel.create(emptyRelationships);

      const result = await LocalUserService.readRelationships({ userId });

      expect(result).not.toBeNull();
      expect(result!.following).toBe(false);
      expect(result!.followed_by).toBe(false);
    });
  });
});
