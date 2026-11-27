import { hasHttpStatus } from '@/libs/error/error.utils';
import { HttpMethod } from '@/libs/http/http.types';
import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import type { NexusTag, NexusUserCounts, NexusUserDetails, TUserId } from '@/services/nexus/nexus.types';
import { fetchNexus, fetchNexusNoContent, queryNexus } from '@/services/nexus/nexus.utils';
import { userApi } from '@/services/nexus/user/user.api';
import type { TUserTagsParams } from '@/services/nexus/user/user.types';

/**
 * Nexus User Service
 *
 * Handles fetching user data from Nexus API.
 */
export class NexusUserService {
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

  /** A standalone account may live on a homeserver the social index has not seen yet. */
  static async ownDetails(params: TUserId): Promise<NexusUserDetails> {
    const url = userApi.details(params);
    let requestedIngest = false;
    return nexusQueryClient.fetchQuery({
      queryKey: ['nexus-own-user-details', url],
      queryFn: async () => {
        try {
          return await fetchNexus<NexusUserDetails>({ url });
        } catch (error) {
          if (!requestedIngest && hasHttpStatus(error, 404)) {
            requestedIngest = true;
            // Discovery is best effort. The same query's normal 404 retries pick up the indexed profile.
            void fetchNexusNoContent({ url: userApi.ingest(params), method: HttpMethod.PUT }).catch(() => {});
          }
          throw error;
        }
      },
    });
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
