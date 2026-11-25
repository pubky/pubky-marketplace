import type { EnrichedPostDetails } from '@/application/moderation/moderation.types';
import { PostApplication } from '@/application/post/post';
import type { TFetchPostParams } from '@/application/post/post.types';
import type { TFetchMorePostTagsParams, TFetchPostTaggersParams } from '@/controllers/post/post.types';
import type { PostCountsModelSchema } from '@/models/post/counts/postCounts.schema';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import type { NexusTag, NexusTaggers } from '@/services/nexus/nexus.types';
import type { TCompositeId } from '@/services/nexus/post/post.types';

export class PostController {
  private constructor() {} // Prevent instantiation

  /**
   * Read post details from local database
   * @param params - Parameters object
   * @param params.compositeId - Composite post ID in format "authorId:postId"
   * @returns Post details or null if not found
   */
  static async getDetails({ compositeId }: TCompositeId): Promise<EnrichedPostDetails | null> {
    return await PostApplication.getDetails({ compositeId });
  }

  /**
   * Read post counts for a specific post
   * @param params - Parameters object
   * @param params.compositeId - Composite post ID in format "authorId:postId"
   * @returns Post counts or null if not found
   */
  static async getCounts({ compositeId }: TCompositeId): Promise<PostCountsModelSchema | null> {
    return await PostApplication.getCounts({ compositeId });
  }

  /**
   * Read post tags for a specific post from local database
   * @param params - Parameters object
   * @param params.compositeId - Composite post ID in format "authorId:postId"
   * @returns Post tags
   */
  static async getTags({ compositeId }: TCompositeId): Promise<TagCollectionModelSchema<string>[]> {
    return await PostApplication.getTags({ compositeId });
  }

  /**
   * Fetch a post from Nexus and persist to local database (network-only, no local read).
   * @param params - Parameters object
   * @param params.compositeId - Composite post ID in format "authorId:postId"
   * @param params.viewerId - Optional viewer ID for relationship data
   * @returns Post details or null if not found
   */
  static async fetch(params: TFetchPostParams): Promise<PostDetailsModelSchema | null> {
    return await PostApplication.fetch(params);
  }

  /**
   * Fetch more post tags from Nexus with pagination
   * @param params - Parameters object
   * @param params.compositeId - Composite post ID in format "authorId:postId"
   * @param params.skip - Number of tags to skip
   * @param params.limit - Maximum number of tags to return
   * @returns Array of tags from Nexus
   */
  static async fetchTags({ compositeId, skip, limit, viewerId }: TFetchMorePostTagsParams): Promise<NexusTag[]> {
    return await PostApplication.fetchTags({ compositeId, skip, limit, viewerId });
  }

  /**
   * Fetch taggers for a specific tag label on a post from Nexus API
   * @param params - Parameters containing composite post ID, label, and pagination options
   * @returns Tagger payload for the label ({ users, relationship })
   */
  static async fetchTaggers(params: TFetchPostTaggersParams): Promise<NexusTaggers> {
    return await PostApplication.fetchTaggers(params);
  }
}
