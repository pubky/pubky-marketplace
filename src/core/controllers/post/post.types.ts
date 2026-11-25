import type { Pubky } from '@/models/models.types';
import type { TCompositeId } from '@/services/nexus/post/post.types';

export interface TFetchMorePostTagsParams extends TCompositeId {
  skip?: number;
  limit?: number;
  viewerId?: Pubky;
}

export interface TFetchPostTaggersParams extends TCompositeId {
  label: string;
  skip?: number;
  limit?: number;
  viewerId?: Pubky;
}
