import {
  TagKind,
  type TCreateTagListInput,
  type TDeleteTagInput,
  type TTagEventParams,
} from '@/application/tag/tag.types';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';
import { TagNormalizer } from '@/pipes/tag/tag.normalizer';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialWriteService } from '@/services/homeserver/social-writes';
import {
  buildMarketplaceTagRowId,
  LocalMarketplaceTagService,
  type MarketplaceTagKind,
} from '@/services/local/tag/marketplace/tag.marketplace';
import { LocalPostTagService } from '@/services/local/tag/post/tag.post';
import { ViewerTagMarkerStorage } from '@/services/local/tag/post/viewerTagMarkerStorage';
import { LocalUserTagService } from '@/services/local/tag/user/tag.user';

function isMarketplaceTagKind(kind: TagKind): kind is MarketplaceTagKind {
  return kind === TagKind.LISTING || kind === TagKind.SHOP;
}

/**
 * Routes a local tag write to the service owning the target kind.
 * Marketplace targets are keyed by their kind-prefixed row id.
 */
async function applyLocalTagWrite(
  op: 'create' | 'delete',
  { taggedKind, taggedId, label, taggerId }: TTagEventParams,
  tagUri?: string,
): Promise<boolean> {
  if (isMarketplaceTagKind(taggedKind)) {
    const rowId = buildMarketplaceTagRowId(taggedKind, taggedId);
    return op === 'create'
      ? LocalMarketplaceTagService.create({ taggerId, taggedId: rowId, label, tagUri })
      : LocalMarketplaceTagService.delete({ taggerId, taggedId: rowId, label });
  }
  if (taggedKind === TagKind.POST) {
    return op === 'create'
      ? LocalPostTagService.create({ taggerId, taggedId, label })
      : LocalPostTagService.delete({ taggerId, taggedId, label });
  }
  return op === 'create'
    ? LocalUserTagService.create({ taggerId, taggedId, label })
    : LocalUserTagService.delete({ taggerId, taggedId, label });
}

/**
 * Tag application service implementing local-first architecture with rollback.
 *
 * **Local-First Write Pattern:**
 * Both `create` and `delete` methods update the local IndexedDB first, then
 * synchronize with the homeserver. This keeps the UI responsive while still
 * compensating locally if the homeserver request fails.
 *
 * **Failure Handling:**
 * If the homeserver request fails after the local update, the failed write is
 * rolled back locally so counters and relationship state stay consistent with
 * Nexus.
 */
export class TagApplication {
  static fetchWriteEpoch(owner: Pubky) {
    return SocialWriteService.getEpoch(owner, 'tags');
  }

  static async prepareTag(params: TTagEventParams) {
    const epoch = await SocialWriteService.requireEpoch(params.taggerId, 'tags');
    return epoch === 'v1' ? TagNormalizer.fromV1(params) : TagNormalizer.from(params);
  }

  /**
   * Commits the create tag operation to the homeserver and local database.
   * @param tagList - The list of tags to create
   */
  static async commitCreate({ tagList, assertCurrent }: TCreateTagListInput) {
    // Process tags one at a time so callers never observe hidden in-flight work
    // from later entries after an earlier tag fails.
    for (const { taggerId, taggedId, label, tagUrl, tagJson, tagBody, taggedKind } of tagList) {
      assertCurrent();
      const didCreateLocally = await applyLocalTagWrite('create', { taggedKind, taggedId, label, taggerId }, tagUrl);

      try {
        assertCurrent();
        if (tagBody) {
          await HomeserverService.putBlob({ url: tagUrl, blob: tagBody });
        } else {
          await HomeserverService.request({ method: HttpMethod.PUT, url: tagUrl, bodyJson: tagJson });
        }
      } catch (error) {
        assertCurrent();
        if (didCreateLocally) {
          try {
            await applyLocalTagWrite('delete', { taggedKind, taggedId, label, taggerId });
          } catch (rollbackError) {
            Logger.error('[TagApplication.commitCreate] Failed to rollback local tag create', {
              taggedId,
              label,
              taggerId,
              taggedKind,
              rollbackError,
            });
          }
        }

        throw error;
      }
    }
  }

  /**
   * Commits the delete tag operation to the homeserver and local database.
   * @param params - The parameters object
   * @param params.taggerId - The ID of the user who is deleting the tag
   * @param params.taggedId - The ID of the post or user who is being tagged
   * @param params.label - The label of the tag
   * @param params.tagUrl - The URL of the tag
   * @param params.taggedKind - The kind of the tagged entity
   */
  static async commitDelete(
    { taggerId, taggedId, label, tagUrl, taggedKind, targetUri }: TDeleteTagInput,
    assertCurrent: () => void,
  ) {
    assertCurrent();
    const storedUrl = isMarketplaceTagKind(taggedKind)
      ? await LocalMarketplaceTagService.getViewerTagUrl(
          buildMarketplaceTagRowId(taggedKind, taggedId),
          label,
          taggerId,
        )
      : undefined;
    assertCurrent();
    const wasDeleted = await applyLocalTagWrite('delete', { taggedKind, taggedId, label, taggerId });

    // Only send to homeserver if something was actually deleted locally
    if (wasDeleted) {
      try {
        // A tag in the index can name its original or migrated copy. Remove the known
        // viewer-owned address first, so a failed second delete stays safe to retry.
        assertCurrent();
        const urls = [tagUrl];
        if (storedUrl && storedUrl !== tagUrl && targetUri) {
          const legacyRoot = `pubky://${taggerId}/pub/pubky.app/tags/`;
          // A legacy account never touches a v1 file. A migrated account can also clean up an
          // indexed v0 copy if its current grant still covers that legacy directory.
          const mayDelete = tagUrl.startsWith(legacyRoot)
            ? storedUrl.startsWith(legacyRoot)
            : !storedUrl.startsWith(legacyRoot) ||
              HomeserverService.canCurrentUserSessionWrite(taggerId, '/pub/pubky.app/tags/');
          if (mayDelete) {
            const copy = await HomeserverService.getJsonIfFound<{ uri: string; label: string }>({ url: storedUrl });
            if (copy.found && copy.json?.uri === targetUri && copy.json.label === label) urls.unshift(storedUrl);
          }
        }
        for (const url of urls) {
          assertCurrent();
          try {
            await HomeserverService.request({ method: HttpMethod.DELETE, url });
          } catch (error) {
            if (!(error instanceof AppError && error.code === ClientErrorCode.NOT_FOUND)) throw error;
          }
        }
      } catch (error) {
        assertCurrent();
        try {
          await applyLocalTagWrite('create', { taggedKind, taggedId, label, taggerId }, storedUrl ?? tagUrl);
        } catch (rollbackError) {
          Logger.error('[TagApplication.commitDelete] Failed to rollback local tag delete', {
            taggedId,
            label,
            taggerId,
            taggedKind,
            rollbackError,
          });
        }

        throw error;
      }
    }
  }

  /**
   * The labels the viewer put on users, most-used first, from the local copy.
   * A read of this device's data: it reflects the users it has seen.
   */
  static async getViewerUserTagLabels(taggerId: Pubky, limit: number): Promise<string[]> {
    return await LocalUserTagService.getLabelsTaggedBy(taggerId, limit);
  }

  /**
   * Clears all viewer-mutation tag markers (sessionStorage) for the given user.
   * Called from logout / session-cleanup paths to drop stale markers before the
   * next user signs in on the same tab.
   */
  static clearViewerMarkers(pubky: Pubky) {
    ViewerTagMarkerStorage.clearForUser(pubky);
  }
}
