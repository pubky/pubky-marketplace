import { PUBKY_APP_PROFILE_PATH } from '@/application/profile/profile.seed';
import type { Pubky } from '@/models/models.types';
import { userDetailsFromHomeserverProfile } from '@/pipes/user/homeserver-profile';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalProfileService } from '@/services/local/profile/profile';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';

/** Well above a profile at every Pubky App limit, so only a hostile record is refused. */
const PROFILE_RECORD_MAX_BYTES = 16 * 1024;

/**
 * A store's profile read: `userId`'s Pubky App profile from their own homeserver (found through
 * Pkarr), cached locally like a Nexus read. Null when the user has no usable profile. Network
 * failures throw.
 */
export async function fetchHomeserverUserDetails(userId: Pubky): Promise<NexusUserDetails | null> {
  const stored = await HomeserverService.getJsonIfFound<unknown>({
    url: `pubky://${userId}${PUBKY_APP_PROFILE_PATH}`,
    maxBytes: PROFILE_RECORD_MAX_BYTES,
    publicRead: true,
  });
  if (!stored.found) return null;
  const details = userDetailsFromHomeserverProfile(stored.json, userId, Date.now());
  if (details) await LocalProfileService.upsertDetails(details);
  return details;
}
