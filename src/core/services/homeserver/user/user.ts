import { userUriBuilder } from 'pubky-app-specs';
import type { Pubky } from '@/models/models.types';
import { userDetailsFromHomeserverProfile } from '@/pipes/user/homeserver-profile';
import { HomeserverService } from '@/services/homeserver/homeserver';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';

/** Well above a profile at every Pubky App limit, so only a hostile record is refused. */
const PROFILE_RECORD_MAX_BYTES = 16 * 1024;

export class UserHomeserverService {
  private constructor() {}

  /**
   * `userId`'s Pubky App profile from their own homeserver (found through Pkarr), in the shape a
   * Nexus read returns. Null when the user has no usable profile. Network failures throw.
   */
  static async fetchDetails(userId: Pubky): Promise<NexusUserDetails | null> {
    const stored = await HomeserverService.getJsonIfFound<unknown>({
      url: userUriBuilder(userId),
      maxBytes: PROFILE_RECORD_MAX_BYTES,
      publicRead: true,
    });
    if (!stored.found) return null;
    return userDetailsFromHomeserverProfile(stored.json, userId, Date.now());
  }
}
