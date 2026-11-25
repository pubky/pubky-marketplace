import { TagApplication } from '@/application/tag/tag';
import { captureAuthWriteGuard } from '@/controllers/auth/auth-scope';
import type { TTagEventParams } from '@/controllers/tag/tag.types';
import type { Pubky } from '@/models/models.types';

export class TagController {
  private constructor() {}

  static fetchWriteEpoch(owner: Pubky) {
    return TagApplication.fetchWriteEpoch(owner);
  }

  /**
   * Create a tag
   * @param params - Parameters object
   * @param params.targetId - ID of the post or user to tag
   * @param params.label - Tag label
   * @param params.taggerId - ID of the user adding the tag
   */
  static async commitCreate(params: TTagEventParams) {
    const assertCurrent = captureAuthWriteGuard();
    const tag = await TagApplication.prepareTag(params);

    await TagApplication.commitCreate({ tagList: [tag], assertCurrent });
  }

  /**
   * The labels the viewer put on users, most-used first, from the local copy
   * (local only: it covers the users this device has seen).
   * @param viewerId - The signed-in user
   * @param limit - Most labels to return
   */
  static async getViewerUserTagLabels(viewerId: Pubky, limit: number) {
    return await TagApplication.getViewerUserTagLabels(viewerId, limit);
  }

  /**
   * Delete a tag
   * @param params - Parameters object
   * @param params.targetId - ID of the post or user
   * @param params.label - Tag label to remove
   * @param params.taggerId - ID of the user removing the tag
   */
  static async commitDelete(params: TTagEventParams) {
    const assertCurrent = captureAuthWriteGuard();
    const { tagUrl, tagJson, label, taggerId, taggedId, taggedKind } = await TagApplication.prepareTag(params);

    await TagApplication.commitDelete(
      {
        taggedId,
        label,
        taggedKind,
        taggerId,
        tagUrl,
        targetUri: typeof tagJson.uri === 'string' ? tagJson.uri : undefined,
      },
      assertCurrent,
    );
  }
}
