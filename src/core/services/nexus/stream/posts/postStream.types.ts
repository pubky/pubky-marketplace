import type { Pubky } from '@/models/models.types';
import type { StreamSorting, TPaginationParams, TPaginationRangeParams } from '@/services/nexus/nexus.types';

export enum StreamSource {
  ALL = 'all',
  FOLLOWING = 'following',
  FOLLOWERS = 'followers',
  FRIENDS = 'friends',
  WOT = 'wot',
  WOT_DOMAIN = 'wot_domain',
  BOOKMARKS = 'bookmarks',
  REPLIES = 'post_replies',
  AUTHOR = 'author',
  AUTHOR_REPLIES = 'author_replies',
  COLLECTION = 'collection',
}

export enum StreamKind {
  SHORT = 'short',
  LONG = 'long',
  IMAGE = 'image',
  VIDEO = 'video',
  LINK = 'link',
  FILE = 'file',
  COLLECTION = 'collection',
}

export enum StreamOrder {
  ASCENDING = 'ascending',
  DESCENDING = 'descending',
}

// Base parameters that are always optional
export type TStreamBase = TPaginationParams &
  TPaginationRangeParams & {
    // The content viewer (for personalization like bookmarks, relationships)
    viewer_id?: Pubky;
    sorting?: StreamSorting;
    kind?: StreamKind;
    order?: StreamOrder;
    tags?: string; // Max 5 tags
    depth?: number;
    domain_tags?: string; // Max 5 profile/domain tags
  };

// Posts by IDs endpoint
export type TStreamPostsByIdsParams = {
  post_ids: string[]; // Required array of post IDs
  viewer_id?: Pubky; // Optional viewer ID
  include_attachment_metadata?: boolean; // Optional include attachment metadata
};
