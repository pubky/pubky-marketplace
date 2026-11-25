import { PostCountsModel } from '@/models/post/counts/postCounts';
import type { PostCountsModelSchema } from '@/models/post/counts/postCounts.schema';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import { PostTagsModel } from '@/models/post/tags/postTags';
import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';

export class LocalPostService {
  private constructor() {}

  /**
   * Read a post from the local database.
   * @param postId - ID of the post to read
   * @returns Post details or null if not found
   */
  static async readDetails({ postId }: { postId: string }) {
    return PostDetailsModel.findById(postId);
  }

  /**
   * Reads post counts for a specific post
   *
   * @param postId - Composite post ID (author:postId)
   * @returns Post counts or null if not found
   */
  static async readCounts(postId: string): Promise<PostCountsModelSchema | null> {
    return (await PostCountsModel.findById(postId)) ?? null;
  }

  /**
   * Reads tags for a specific post from local database
   * @param postId - Composite post ID (author:postId)
   * @returns Array of tag collections or empty array if not found
   */
  static async readTags(postId: string): Promise<TagCollectionModelSchema<string>[]> {
    const tags = await PostTagsModel.findById(postId);
    if (!tags) return [];
    return [tags] as unknown as TagCollectionModelSchema<string>[];
  }
}
