import { detectModerationFromTags } from '@/application/moderation/moderation.utils';
import { CompositeIdDomain } from '@/models/models.types';
import { buildCompositeId, buildCompositeIdFromPubkyUri } from '@/models/models.utils';
import { ModerationModel } from '@/models/moderation/moderation';
import { type ModerationModelSchema, ModerationType } from '@/models/moderation/moderation.schema';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import { DELETED } from '@/models/post/details/postDetails.constants';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import { PostRelationshipsModel } from '@/models/post/relationships/postRelationships';
import { PostTagsModel } from '@/models/post/tags/postTags';
import { PostTtlModel } from '@/models/post/ttl/postTtl';
import type { RecordModelBase } from '@/models/shared/base/record/baseRecord';
import type { NexusModelTuple } from '@/models/shared/base/tuple/baseTuple.type';
import {
  buildPostReplyStreamId,
  type PostStreamId,
  type ReplyStreamCompositeId,
} from '@/models/stream/post/postStream.types';
import { PostStreamModel } from '@/models/stream/post/tables/postStream';
import type {
  TAddReplyToStreamParams,
  TPersistPostsParams,
  TPostStreamPersistResult,
  TPostStreamUpsertParams,
} from '@/services/local/stream/posts/post.types';
import type { NexusFileDetails, NexusPostCounts, NexusPostRelationships, NexusTag } from '@/services/nexus/nexus.types';
import { StreamSource } from '@/services/nexus/stream/posts/postStream.types';
import { sortPostIdsByTimestamp } from '@/utils/sorting';

/**
 * Local Stream Posts Service
 *
 * Simple service to manage post stream IDs in IndexDB.
 * Only stores arrays of post IDs, no post data or user data.
 */
export class LocalStreamPostsService {
  private constructor() {}

  static async getNotPersistedPostsInCache(postIds: string[]): Promise<string[]> {
    const existingPostIds = await PostDetailsModel.findByIdsPreserveOrder(postIds);
    return postIds.filter((_postId, index) => existingPostIds[index] === undefined);
  }

  /**
   * Adds a reply post to the post replies map if the post is a reply
   *
   * @param repliedUri - The URI of the parent post being replied to (optional)
   * @param replyPostId - The composite post ID of the reply post
   * @param postReplies - The map of reply stream IDs to arrays of reply post IDs
   */
  private static addReplyToStream({ repliedUri, replyPostId, postReplies }: TAddReplyToStreamParams): void {
    if (!repliedUri) return;

    const parentCompositePostId = buildCompositeIdFromPubkyUri({
      uri: repliedUri,
      domain: CompositeIdDomain.POSTS,
    });
    if (!parentCompositePostId) return;

    const replyStreamId = buildPostReplyStreamId(parentCompositePostId);
    postReplies[replyStreamId] = [...(postReplies[replyStreamId] || []), replyPostId];
  }

  /**
   * Persist posts from Nexus API to local IndexedDB
   *
   * Processes an array of Nexus posts and saves them to the local database.
   * For each post, it extracts and persists:
   * - Post details (with composite ID: author:postId)
   * - Post counts (likes, replies, etc.)
   * - Post relationships (replies, reposts, etc.)
   * - Post tags
   * - Post attachments
   *
   * Additionally, creates reply streams for posts that are replies to other posts,
   * mapping parent posts to their reply post IDs.
   *
   * @param posts - Array of posts from Nexus API to persist
   * @returns Object containing an array of all post attachment URIs collected from the posts
   */
  static async persistPosts({ posts, signal }: TPersistPostsParams): Promise<TPostStreamPersistResult> {
    // Defensive check: if posts is empty or undefined, return early
    if (!posts?.length) return { attachmentMetadata: [] };

    const postCounts: NexusModelTuple<NexusPostCounts>[] = [];
    const postRelationships: NexusModelTuple<NexusPostRelationships>[] = [];
    const postTags: NexusModelTuple<NexusTag[]>[] = [];
    const postDetails: RecordModelBase<string, PostDetailsModelSchema>[] = [];
    const postModerations: ModerationModelSchema[] = [];
    const postTtl: NexusModelTuple<{ lastUpdatedAt: number }>[] = [];

    const postReplies: Record<ReplyStreamCompositeId, string[]> = {};
    const attachmentMetadata: NexusFileDetails[] = [];
    const now = Date.now();

    for (const post of posts) {
      // Build composite ID to ensure uniqueness (authorId:postId)
      const postId = buildCompositeId({ pubky: post.details.author, id: post.details.id });

      postCounts.push([postId, post.counts]);

      postRelationships.push([postId, post.relationships]);
      if (post.attachments_metadata) {
        post.attachments_metadata.forEach((metadata) => {
          attachmentMetadata.push(metadata);
        });
      }

      // Convert TagModel[] to NexusTag[] by accessing the data property
      const nexusTags = post.tags.map((tag) => ({
        label: tag.label,
        taggers: tag.taggers,
        taggers_count: tag.taggers_count,
        relationship: tag.relationship,
      }));
      postTags.push([postId, nexusTags]);

      // Compute moderation and store if post is moderated
      const isModerated = detectModerationFromTags(nexusTags);
      if (isModerated) {
        postModerations.push({
          id: postId,
          type: ModerationType.POST,
          is_blurred: true,
          created_at: Date.now(),
        });
      }

      // Remove author from details as it's in the composite ID
      // eslint-disable-next-line
      const { author, ...detailsWithoutAuthor } = post.details;
      postDetails.push({ ...detailsWithoutAuthor, id: postId });

      // Record TTL for freshness tracking
      postTtl.push([postId, { lastUpdatedAt: now }]);

      // Add reply to the post replies map if this post is a reply
      this.addReplyToStream({ repliedUri: post.relationships.replied, replyPostId: postId, postReplies });
    }

    // The by-ids endpoint can lag deletion. Preserve tombstones already on
    // this device and omit their IDs from each related table's batch.
    const tombstonedIds = new Set(
      (await PostDetailsModel.findByIdsPreserveOrder(postDetails.map((d) => d.id)))
        .map((existing, i) => (existing?.content === DELETED ? postDetails[i].id : null))
        .filter((id): id is string => id !== null),
    );
    signal?.throwIfAborted();
    const liveDetails = postDetails.filter((d) => !tombstonedIds.has(d.id));
    const liveCounts = postCounts.filter(([id]) => !tombstonedIds.has(id));
    const liveRelationships = postRelationships.filter(([id]) => !tombstonedIds.has(id));
    const liveTags = postTags.filter(([id]) => !tombstonedIds.has(id));
    const liveTtl = postTtl.filter(([id]) => !tombstonedIds.has(id));
    const liveModerations = postModerations.filter((m) => !tombstonedIds.has(m.id));

    await Promise.all([
      PostDetailsModel.bulkSave(liveDetails),
      PostCountsModel.bulkSave(liveCounts),
      PostTagsModel.bulkSave(liveTags),
      PostRelationshipsModel.bulkSave(liveRelationships),
      PostTtlModel.bulkSave(liveTtl),
      // Persist moderation records for moderated posts (is_blurred defaults to true)
      liveModerations.length > 0 ? ModerationModel.bulkSave(liveModerations) : Promise.resolve(),
    ]);

    if (Object.keys(postReplies).length > 0) {
      await Promise.all(
        Object.entries(postReplies).map(async ([parentCompositePostId, postIds]) => {
          await this.persistNewStreamChunk({
            streamId: parentCompositePostId as PostStreamId,
            stream: postIds,
            signal,
          });
        }),
      );
    }
    return { attachmentMetadata };
  }

  /**
   * Persist a new chunk of post IDs into a cached stream.
   *
   * Creates the stream when it does not exist yet. Otherwise merges the incoming
   * IDs with the existing stream and removes duplicates before saving.
   *
   * Normal timeline streams are re-sorted by post timestamp. Bookmark streams
   * preserve membership order because their meaningful ordering is bookmark
   * creation time, not post creation time.
   *
   * @param stream - Incoming post IDs to merge into the stream cache
   * @param streamId - Stream identifier to create or update
   */
  static async persistNewStreamChunk({ stream, streamId, signal }: TPostStreamUpsertParams) {
    const postStream = await PostStreamModel.findById(streamId);
    signal?.throwIfAborted();

    if (!postStream) {
      // If stream doesn't exist (e.g., database was deleted), create it with the new chunk
      await PostStreamModel.upsert(streamId, stream);
      return;
    }

    // Check for duplicates before adding
    const existingIds = new Set(postStream.stream);
    const newPostsToAdd = stream.filter((id) => !existingIds.has(id));

    // Combine existing and new posts
    const combinedStream = [...postStream.stream, ...newPostsToAdd];

    if (this.isBookmarkStream(streamId)) {
      await PostStreamModel.upsert(streamId, combinedStream);
      return;
    }

    // Sort by timestamp (indexed_at) in descending order (most recent first)
    const sortedStream = await sortPostIdsByTimestamp(combinedStream);
    signal?.throwIfAborted();

    await PostStreamModel.upsert(streamId, sortedStream);
  }

  private static isBookmarkStream(streamId: PostStreamId): boolean {
    return streamId.includes(`:${StreamSource.BOOKMARKS}:`);
  }
}
