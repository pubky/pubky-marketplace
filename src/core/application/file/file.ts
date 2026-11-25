import { Logger } from '@/libs/logger/logger';
import { CompositeIdDomain, type Pubky } from '@/models/models.types';
import { buildCompositeIdFromPubkyUri } from '@/models/models.utils';
import { LocalFileService } from '@/services/local/file/file';
import { filesApi } from '@/services/nexus/file/file.api';
import type { NexusFileDetails, NexusFileUrls } from '@/services/nexus/nexus.types';

export class FileApplication {
  private constructor() {}

  static getAvatarUrl(pubky: Pubky, version?: string | number): string {
    return filesApi.getAvatarUrl(pubky, version);
  }

  /**
   * Transforms and persists file metadata to the local database.
   * Builds composite IDs from URIs, parses URL fields, and saves them locally.
   *
   * @param fileAttachments - Array of file metadata objects already available (no HTTP fetch needed)
   */
  static async persistFiles(fileAttachments: NexusFileDetails[]) {
    if (fileAttachments.length === 0) {
      return;
    }

    const filesWithCompositeIds = fileAttachments.flatMap((file) => {
      const compositeId = buildCompositeIdFromPubkyUri({
        uri: file.uri,
        domain: CompositeIdDomain.FILES,
      });
      // A malformed remote record must not prevent valid peers from being stored.
      if (!compositeId) {
        Logger.warn('Ignoring file metadata with an invalid URI');
        return [];
      }
      let urls: NexusFileUrls;
      try {
        urls = typeof file.urls === 'string' ? (JSON.parse(file.urls) as NexusFileUrls) : file.urls;
      } catch {
        Logger.warn('Ignoring file metadata with malformed URL JSON', { fileId: compositeId });
        return [];
      }
      return [{ ...file, urls, id: compositeId }];
    });

    if (filesWithCompositeIds.length) await LocalFileService.createMany({ files: filesWithCompositeIds });
  }
}
