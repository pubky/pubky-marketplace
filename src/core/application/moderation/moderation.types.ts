import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';

export type EnrichedPostDetails = PostDetailsModelSchema & {
  is_moderated: boolean;
  is_blurred: boolean;
};
