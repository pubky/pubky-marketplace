import type { Pubky } from '@/models/models.types';
import type { NexusPost } from '@/services/nexus/nexus.types';

export interface TMissingPostsParams {
  cacheMissPostIds: string[];
  /** Optional viewer ID for relationship data. Null/undefined for unauthenticated views. */
  viewerId?: Pubky | null;
  /** Aborted when the viewer signs out; nothing is persisted after that. */
  signal?: AbortSignal;
}

export interface TFetchMissingUsersParams {
  posts: NexusPost[];
  /** Optional viewer ID for relationship data. Null/undefined for unauthenticated views. */
  viewerId?: Pubky | null;
  /** Aborted when the viewer signs out; nothing is persisted after that. */
  signal?: AbortSignal;
}
