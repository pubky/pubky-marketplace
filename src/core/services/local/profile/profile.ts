import type { Pubky } from '@/models/models.types';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserDetailsModel } from '@/models/user/details/userDetails';
import type { NexusUserCounts, NexusUserDetails } from '@/services/nexus/nexus.types';

export class LocalProfileService {
  private constructor() {} // Prevent instantiation

  /**
   * Upserts user details into local database.
   * @param userDetails - The user details to upsert
   * @returns Promise resolving to void
   */
  static async upsertDetails(userDetails: NexusUserDetails): Promise<void> {
    await UserDetailsModel.upsert(userDetails);
  }

  /**
   * Upserts user counts into local database.
   * @param userId - The user ID to upsert counts for
   * @param userCounts - The user counts to upsert
   * @returns Promise resolving to void
   */
  static async upsertCounts(userId: Pubky, userCounts: NexusUserCounts): Promise<void> {
    await UserCountsModel.upsert({
      id: userId,
      ...userCounts,
    });
  }
}
