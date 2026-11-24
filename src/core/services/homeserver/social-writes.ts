import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';
import { socialNexusServesV1 } from '@/services/nexus/social-v1';

export const SOCIAL_WRITE_UNAVAILABLE = 'Open Pubky App to use social features with this account.';

export class SocialWriteService {
  /** Nexus switches roots when it sees this user's v1 profile, independently for each author. */
  static async getEpoch(owner: string, resource: 'tags' | 'follows'): Promise<'legacy' | 'v1' | null> {
    const profile = await SocialProfileService.getEpoch(owner);
    if (profile === 'legacy') {
      return HomeserverService.canCurrentUserSessionWrite(owner, `/pub/pubky.app/${resource}/`) ? 'legacy' : null;
    }
    if (profile === 'v1' && (await socialNexusServesV1()) && SocialProfileService.canWriteV1(owner)) return 'v1';
    return null;
  }

  static async requireEpoch(owner: string, resource: 'tags' | 'follows'): Promise<'legacy' | 'v1'> {
    const epoch = await this.getEpoch(owner, resource);
    if (!epoch) {
      throw Err.auth(AuthErrorCode.FORBIDDEN, SOCIAL_WRITE_UNAVAILABLE, {
        service: ErrorService.Homeserver,
        operation: 'socialWrite',
      });
    }
    return epoch;
  }
}
