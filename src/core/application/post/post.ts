import type { EnrichedPostDetails } from '@/application/moderation/moderation.types';
import type { TFetchPostParams } from '@/application/post/post.types';
import { PostStreamApplication } from '@/application/stream/posts/post';
import { ModerationController } from '@/controllers/moderation/moderation';
import type { TFetchMorePostTagsParams, TFetchPostTaggersParams } from '@/controllers/post/post.types';
import type { PostCountsModelSchema } from '@/models/post/counts/postCounts.schema';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import { LocalPostService } from '@/services/local/post/post';
import { LocalPostTagService } from '@/services/local/tag/post/tag.post';
import type { NexusTag, NexusTaggers } from '@/services/nexus/nexus.types';
import { NexusPostService } from '@/services/nexus/post/post';
import type { TCompositeId } from '@/services/nexus/post/post.types';

export class PostApplication {
  /**
   * Reads post details from local database and enriches with moderation state
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @returns Post details with moderation state or null if not found
   */
  static async getDetails({ compositeId }: TCompositeId): Promise<EnrichedPostDetails | null> {
    const post = await LocalPostService.readDetails({ postId: compositeId });
    if (!post) return null;
    const [enriched] = await ModerationController.enrichPosts([post]);
    return enriched;
  }

  /**
   * Reads post counts for a specific post
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @returns Post counts or null if not found
   */
  static async getCounts({ compositeId }: TCompositeId): Promise<PostCountsModelSchema | null> {
    return await LocalPostService.readCounts(compositeId);
  }

  /**
   * Reads post tags for a specific post from local database
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @returns Post tags
   */
  static async getTags({ compositeId }: TCompositeId): Promise<TagCollectionModelSchema<string>[]> {
    return await LocalPostService.readTags(compositeId);
  }

  /**
   * Fetch more post tags from Nexus with pagination and persist to local DB
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @param skip - Number of tags to skip
   * @param limit - Maximum number of tags to return
   * @returns Array of tags from Nexus
   */
  static async fetchTags({ compositeId, skip, limit, viewerId }: TFetchMorePostTagsParams): Promise<NexusTag[]> {
    const nexusTags = await NexusPostService.getPostTags({ compositeId, skip, limit, viewerId });

    // Persist new tags to local DB (merge with existing)
    if (nexusTags.length > 0) {
      await LocalPostTagService.mergeTags({ postId: compositeId, tags: nexusTags, viewerId: viewerId ?? null });
    }

    return nexusTags;
  }

  /**
   * Fetch taggers for a specific tag label on a post from Nexus API
   * @param params - Parameters containing composite post ID, label, and pagination options
   * @returns Tagger payload for the label ({ users, relationship })
   */
  static async fetchTaggers(params: TFetchPostTaggersParams): Promise<NexusTaggers> {
    return await NexusPostService.getPostTaggers(params);
  }

  /**
   * Fetches a post from Nexus and persists to local database (network-only, no local read).
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @param viewerId - Optional viewer ID for relationship data
   * @returns Post details or null if not found on Nexus
   */
  static async fetch({ compositeId, viewerId }: TFetchPostParams): Promise<PostDetailsModelSchema | null> {
    await PostStreamApplication.fetchMissingPostsFromNexus({
      cacheMissPostIds: [compositeId],
      viewerId,
    });

    return await LocalPostService.readDetails({ postId: compositeId });
  }
}
