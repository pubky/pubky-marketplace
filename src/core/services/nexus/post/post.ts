import type { TFetchMorePostTagsParams, TFetchPostTaggersParams } from '@/controllers/post/post.types';
import { parseCompositeId } from '@/models/models.utils';
import type { NexusTag, NexusTaggers } from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { postApi } from '@/services/nexus/post/post.api';

export class NexusPostService {
  private constructor() {}

  /**
   * Fetches tags for a post from Nexus API
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @param skip - Number of tags to skip (for pagination)
   * @param limit - Maximum number of tags to return
   * @returns An array of tags (empty array if post has no tags)
   * @throws {NexusError} When post is not found or request fails
   */
  static async getPostTags({ compositeId, skip, limit, viewerId }: TFetchMorePostTagsParams): Promise<NexusTag[]> {
    const { pubky: author_id, id: post_id } = parseCompositeId(compositeId);

    const url = postApi.tags({ author_id, post_id, skip_tags: skip, limit_tags: limit, viewer_id: viewerId });
    return await queryNexus<NexusTag[]>({ url });
  }

  /**
   * Fetches taggers for a post tag label from Nexus API
   * @param compositeId - Composite post ID in format "authorId:postId"
   * @param label - Tag label to fetch taggers for
   * @param skip - Number of taggers to skip (pagination)
   * @param limit - Maximum number of taggers to return
   * @param viewerId - Optional viewer ID for relationship data
   * @returns Tagger payload for the label ({ users, relationship })
   */
  static async getPostTaggers({
    compositeId,
    label,
    skip,
    limit,
    viewerId,
  }: TFetchPostTaggersParams): Promise<NexusTaggers> {
    const { pubky: author_id, id: post_id } = parseCompositeId(compositeId);

    const url = postApi.taggers({
      author_id,
      post_id,
      label,
      skip,
      limit,
      viewer_id: viewerId,
    });
    return await queryNexus<NexusTaggers>({ url });
  }
}
