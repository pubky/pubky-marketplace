import {
  BITKIT_PROFILE_PATHS,
  parseBitkitProfileSeed,
  parsePubkyAppProfileSeed,
} from '@/application/profile/profile.seed';
import type { TProfileSeed } from '@/application/profile/profile.types';
import { isAppError } from '@/libs/error/error.utils';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';

export class ProfileApplication {
  private constructor() {}

  /** Prefills the seller's new shop from their public social or Bitkit profile. */
  static async readProfileSeed({ pubky }: { pubky: Pubky }): Promise<TProfileSeed | null> {
    try {
      const profile = await SocialProfileService.read(pubky);
      if (profile.epoch !== 'missing') {
        const seed = parsePubkyAppProfileSeed(profile.json);
        if (seed) return seed;
      }
    } catch (error) {
      Logger.warn('[ProfileApplication] Social profile could not be read for prefill', {
        code: isAppError(error) ? error.code : 'unknown',
      });
    }
    for (const path of BITKIT_PROFILE_PATHS) {
      const url = `pubky://${pubky}${path}`;
      try {
        if (!(await HomeserverService.exists(url))) continue;
        const seed = parseBitkitProfileSeed(await HomeserverService.request<unknown>({ method: HttpMethod.GET, url }));
        if (seed) return seed;
      } catch (error) {
        Logger.warn('[ProfileApplication] Existing profile could not be read for prefill', {
          path,
          code: isAppError(error) ? error.code : 'unknown',
        });
      }
    }
    return null;
  }
}
