import { FollowResult } from 'pubky-app-specs';
import { buildFollow, deletionPaths, toUrl } from 'pubky-social-specs';
import type { TFollowParams } from '@/controllers/user/user.type';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { stripPubkyPrefix } from '@/libs/utils/utils';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';

export class FollowNormalizer {
  private constructor() {}

  static record(params: TFollowParams, epoch: 'legacy' | 'v1') {
    if (epoch === 'legacy') {
      const { follow, meta } = this.to(params);
      return {
        followUrl: meta.url,
        get followJson(): Record<string, unknown> {
          return follow.toJson();
        },
      };
    }
    try {
      const follow = buildFollow(params.follower, stripPubkyPrefix(params.followee));
      return {
        followUrl: follow.url,
        followJson: { ...follow.object },
        followBody: follow.body,
        deleteUrls: deletionPaths({ kind: 'follow', id: follow.id }).map((path) => toUrl(params.follower, path)),
      };
    } catch (cause) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid social follow', {
        service: ErrorService.PubkyAppSpecs,
        operation: 'buildFollow',
        cause,
      });
    }
  }

  static to({ follower, followee }: TFollowParams): FollowResult {
    try {
      const builder = PubkySpecsSingleton.get(follower);
      // Strip any prefix (pubky or pk:) from the followee ID before passing to createFollow
      // pubky-app-specs expects a raw 52-character z-base-32 encoded public key
      const normalizedFollowee = stripPubkyPrefix(followee);
      const result = builder.createFollow(normalizedFollowee);
      return result;
    } catch (error) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, error as string, {
        service: ErrorService.PubkyAppSpecs,
        operation: 'createFollow',
        context: { follower, followee },
      });
    }
  }
}
