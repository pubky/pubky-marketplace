import { postUriBuilder, TagResult, userUriBuilder } from 'pubky-app-specs';
import { buildMarketUri } from 'pubky-market-specs';
import { buildTag, buildUri } from 'pubky-social-specs';
import { TagKind } from '@/application/tag/tag.types';
import type { TTagEventParams, TTagFromResponse } from '@/controllers/tag/tag.types';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { Pubky } from '@/models/models.types';
import { parseCompositeId } from '@/models/models.utils';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';

export class TagNormalizer {
  private constructor() {}

  static from({ taggedKind, taggedId, label, taggerId }: TTagEventParams): TTagFromResponse {
    try {
      let uri: string;
      if (taggedKind === TagKind.POST) {
        const { pubky, id: postId } = parseCompositeId(taggedId);
        uri = postUriBuilder(pubky, postId);
      } else if (taggedKind === TagKind.LISTING) {
        const { pubky, id: listingId } = parseCompositeId(taggedId);
        uri = buildMarketUri(pubky, 'listing', listingId);
      } else if (taggedKind === TagKind.SHOP) {
        uri = buildMarketUri(taggedId, 'shop');
      } else {
        uri = userUriBuilder(taggedId);
      }
      const { tag, meta } = TagNormalizer.to(uri, label.trim(), taggerId);

      return {
        taggerId,
        taggedId,
        label: tag.label.toLowerCase(),
        taggedKind,
        tagUrl: meta.url,
        tagJson: tag.toJson(),
      };
    } catch (error) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, error as string, {
        service: ErrorService.PubkyAppSpecs,
        operation: 'createTagFromParams',
        context: { taggedKind, taggedId, label, taggerId },
      });
    }
  }

  /** The commerce target keeps its signed URI while the tag file belongs to social/v1. */
  static fromV1(params: TTagEventParams): TTagFromResponse {
    const { taggedId, taggedKind, taggerId, label } = params;
    try {
      let target: string;
      if (taggedKind === TagKind.LISTING || taggedKind === TagKind.POST) {
        const { pubky, id } = parseCompositeId(taggedId);
        target = taggedKind === TagKind.LISTING ? buildMarketUri(pubky, 'listing', id) : buildUri(pubky, 'post', id);
      } else {
        target = taggedKind === TagKind.SHOP ? buildMarketUri(taggedId, 'shop') : buildUri(taggedId, 'user');
      }
      const tag = buildTag(taggerId, target, label);
      return { ...params, label: tag.object.label, tagUrl: tag.url, tagJson: { ...tag.object }, tagBody: tag.body };
    } catch (cause) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid social tag', {
        service: ErrorService.PubkyAppSpecs,
        operation: 'buildTag',
        cause,
      });
    }
  }

  static to(uri: string, label: string, pubky: Pubky): TagResult {
    try {
      const builder = PubkySpecsSingleton.get(pubky);
      return builder.createTag(uri, label);
    } catch (error) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, error as string, {
        service: ErrorService.PubkyAppSpecs,
        operation: 'createTag',
        context: { uri, label, pubky },
      });
    }
  }
}
