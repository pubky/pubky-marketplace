import type { TagWithAvatars } from '@/molecules/TaggedItem/TaggedItem.types';

export interface UseEnrichedTagsResult {
  /** Tags with enriched tagger details (name, avatarUrl) */
  enrichedTags: TagWithAvatars[];
}
