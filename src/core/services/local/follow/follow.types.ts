import type { Pubky } from '@/models/models.types';

export interface UpdateUserStreamsParams {
  isFollowing: boolean;
  follower: Pubky;
  followee: Pubky;
  friendshipChanged: boolean;
}
