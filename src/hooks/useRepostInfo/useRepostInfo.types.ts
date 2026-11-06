export interface UseRepostInfoResult {
  /** Whether the post is a repost (used by PostContent, PostMain) */
  isRepost: boolean;
  /** Whether the current user is the one who reposted (used by PostMain) */
  isCurrentUserRepost: boolean;
  /** Original post ID if this is a repost (used by PostContent) */
  originalPostId: string | null;
}
