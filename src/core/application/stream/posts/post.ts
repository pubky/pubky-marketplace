import { FileApplication } from '@/application/file/file';
import type { TFetchMissingUsersParams, TMissingPostsParams } from '@/application/stream/posts/post.types';
import { Logger } from '@/libs/logger/logger';
import { CompositeIdDomain, type Pubky } from '@/models/models.types';
import { buildCompositeIdFromPubkyUri } from '@/models/models.utils';
import { UserDetailsModel } from '@/models/user/details/userDetails';
import { LocalStreamPostsService } from '@/services/local/stream/posts/posts';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';

export class PostStreamApplication {
  private constructor() {}

  /**
   * Fetch missing posts from nexus and persist them to cache
   * @param cacheMissPostIds - Array of post IDs that are not persisted in cache
   * @param viewerId - ID of the viewer
   */
  static async fetchMissingPostsFromNexus({ cacheMissPostIds, viewerId, signal }: TMissingPostsParams) {
    try {
      const postBatch = await NexusPostStreamService.fetchByIds({
        post_ids: cacheMissPostIds,
        // Only pass viewer_id if it's a valid string (not null/undefined)
        ...(viewerId ? { viewer_id: viewerId } : {}),
      });
      signal?.throwIfAborted();
      const { attachmentMetadata } = await LocalStreamPostsService.persistPosts({ posts: postBatch, signal });
      signal?.throwIfAborted();
      await FileApplication.persistFiles(attachmentMetadata);
      // Persist the missing authors of the posts
      await this.fetchMissingUsersFromNexus({ posts: postBatch, viewerId, signal });
      // Fetch original posts for any reposts (to display embedded repost content)
      const repostedUris = postBatch
        .map((post) => post.relationships.reposted)
        .filter((uri): uri is string => uri !== null);
      await this.fetchOriginalPostsByUris({ repostedUris, viewerId, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      Logger.warn('Failed to fetch missing posts from Nexus', { cacheMissPostIds, viewerId, error });
    }
  }

  /**
   * Shared logic for fetching original posts by their URIs.
   * Converts URIs to IDs, checks cache, fetches missing posts from Nexus, and persists them.
   * This method is public to allow reuse by TtlApplication for refreshing repost originals.
   * @param repostedUris - Array of pubky URIs pointing to original posts
   * @param viewerId - ID of the viewer
   */
  static async fetchOriginalPostsByUris({
    repostedUris,
    viewerId,
    signal,
  }: {
    repostedUris: string[];
    /** Optional viewer ID for relationship data. Null/undefined for unauthenticated views. */
    viewerId?: Pubky | null;
    /** Aborted when the viewer signs out; nothing is persisted after that. */
    signal?: AbortSignal;
  }) {
    if (repostedUris.length === 0) return;

    // Convert URIs to composite IDs and deduplicate
    const originalPostIds = Array.from(
      new Set(
        repostedUris
          .map((uri) =>
            buildCompositeIdFromPubkyUri({
              uri,
              domain: CompositeIdDomain.POSTS,
            }),
          )
          .filter((id): id is string => id !== null),
      ),
    );

    if (originalPostIds.length === 0) return;

    // Filter out posts already in local DB
    const missingOriginalPostIds = await LocalStreamPostsService.getNotPersistedPostsInCache(originalPostIds);

    if (missingOriginalPostIds.length === 0) return;

    Logger.debug('Fetching original posts for reposts', {
      repostCount: repostedUris.length,
      originalCount: originalPostIds.length,
      missingOriginalCount: missingOriginalPostIds.length,
    });

    try {
      const originalPosts = await NexusPostStreamService.fetchByIds({
        post_ids: missingOriginalPostIds,
        viewer_id: viewerId ?? undefined,
      });
      signal?.throwIfAborted();
      const { attachmentMetadata } = await LocalStreamPostsService.persistPosts({ posts: originalPosts, signal });
      signal?.throwIfAborted();
      await FileApplication.persistFiles(attachmentMetadata);
      await this.fetchMissingUsersFromNexus({ posts: originalPosts, viewerId, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      Logger.warn('Failed to fetch original posts for reposts', { missingOriginalPostIds, error });
    }
  }

  private static async fetchMissingUsersFromNexus({ posts, viewerId, signal }: TFetchMissingUsersParams) {
    const cacheMissUserIds = await this.getNotPersistedUsersInCache(posts.map((post) => post.details.author));
    if (cacheMissUserIds.length > 0) {
      const userBatch = await NexusUserStreamService.fetchByIds({
        user_ids: cacheMissUserIds,
        viewer_id: viewerId ?? undefined,
      });
      signal?.throwIfAborted();
      await LocalStreamUsersService.persistUsers(userBatch);
    }
  }

  // Delegate to service for cache miss detection
  private static async getNotPersistedUsersInCache(userIds: Pubky[]): Promise<Pubky[]> {
    const existingUserIds = await UserDetailsModel.findByIdsPreserveOrder(userIds);
    const missingUserIds = userIds.filter((_userId, index) => existingUserIds[index] === undefined);
    return Array.from(new Set(missingUserIds));
  }
}
