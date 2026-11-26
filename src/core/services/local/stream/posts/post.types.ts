import type { PostStreamId, ReplyStreamCompositeId } from '@/models/stream/post/postStream.types';
import type { NexusFileDetails, NexusPostWithAttachmentMetadata } from '@/services/nexus/nexus.types';
import type { StreamSource, TStreamBase } from '@/services/nexus/stream/posts/postStream.types';

export interface TPostStreamUpsertParams {
  streamId: PostStreamId;
  stream: string[];
  /** Once aborted, the stream is left as it is. */
  signal?: AbortSignal;
}

export interface TAddReplyToStreamParams {
  repliedUri: string | null | undefined;
  replyPostId: string;
  postReplies: Record<ReplyStreamCompositeId, string[]>;
}

export interface TPersistPostsParams {
  posts: NexusPostWithAttachmentMetadata[];
  /** Once aborted, nothing more is saved. */
  signal?: AbortSignal;
}

export interface TPostStreamPersistResult {
  attachmentMetadata: NexusFileDetails[];
}

export interface TSetStreamPaginationParams {
  params: TStreamBase;
  streamTail: number;
  streamHead?: number;
  invokeEndpoint: StreamSource;
}
