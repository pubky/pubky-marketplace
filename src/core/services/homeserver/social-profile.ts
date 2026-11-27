import { userUriBuilder } from 'pubky-app-specs';
import { buildUri } from 'pubky-social-specs';
import { HomeserverService } from '@/services/homeserver/homeserver';

type SocialProfile = { epoch: 'v1' | 'legacy'; json: unknown } | { epoch: 'missing' };

export class SocialProfileService {
  /** The v1 profile takes precedence even while the homeserver retains the legacy copy. */
  static async read(pubky: string): Promise<SocialProfile> {
    const current = await HomeserverService.getJsonIfFound({ url: buildUri(pubky, 'user'), publicRead: true });
    if (current.found) return { epoch: 'v1', json: current.json };

    const legacy = await HomeserverService.getJsonIfFound({
      url: userUriBuilder(pubky),
      publicRead: true,
    });
    return legacy.found ? { epoch: 'legacy', json: legacy.json } : { epoch: 'missing' };
  }

  static async getEpoch(pubky: string): Promise<SocialProfile['epoch']> {
    return (await this.read(pubky)).epoch;
  }

  static canWriteV1(pubky: string): boolean {
    return HomeserverService.canCurrentHostSessionWrite(pubky, '/pub/social/v1/');
  }
}
