import type {
  NexusNotification,
  NexusTag,
  NexusUserCounts,
  NexusUserDetails,
  TUserId,
} from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { userApi } from '@/services/nexus/user/user.api';
import type { TUserPaginationParams, TUserTagsParams } from '@/services/nexus/user/user.types';

/**
 * Nexus User Service
 *
 * Handles fetching user data from Nexus API.
 */
export class NexusUserService {
  /**
   * Retrieves user data from Nexus API
   *
   * @param pubky - User's public key
   * @returns user data (users, posts, streams)
   */
  static async notifications(params: TUserPaginationParams): Promise<NexusNotification[]> {
    const url = userApi.notifications(params);
    return await queryNexus<NexusNotification[]>({ url });
  }

  /**
   * Retrieves tags for a user from Nexus API
   *
   * @param params - Parameters containing user ID and pagination options
   * @returns Array of tags assigned to the user
   */
  static async tags(params: TUserTagsParams): Promise<NexusTag[]> {
    const url = userApi.tags(params);
    return await queryNexus<NexusTag[]>({ url });
  }

  /**
   * Retrieves user details from Nexus API
   *
   * @param params - Parameters containing user ID
   * @returns User details including name, bio, status, image, and links
   */
  static async details(params: TUserId): Promise<NexusUserDetails> {
    const url = userApi.details(params);
    return await queryNexus<NexusUserDetails>({ url });
  }

  /**
   * Retrieves user counts from Nexus API
   *
   * @param params - Parameters containing user ID
   * @returns User counts including followers, following, and friends
   */
  static async counts(params: TUserId): Promise<NexusUserCounts> {
    const url = userApi.counts(params);
    return await queryNexus<NexusUserCounts>({ url });
  }
}
