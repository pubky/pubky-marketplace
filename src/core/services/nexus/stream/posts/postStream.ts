import { HttpMethod } from '@/libs/http/http.types';
import { fetchByIdsInChunks } from '@/services/nexus/nexus.by-ids';
import type { NexusPostWithAttachmentMetadata } from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { postStreamApi } from '@/services/nexus/stream/posts/postStream.api';
import type { TStreamPostsByIdsParams } from '@/services/nexus/stream/posts/postStream.types';

/**
 * Nexus Post Stream Service
 *
 * Handles fetching post stream data from Nexus API.
 */
export class NexusPostStreamService {
  /**
   * Fetches posts by their IDs from Nexus API
   *
   * @param params - Parameters containing post IDs and optional viewer ID
   * @returns Array of posts
   */
  static async fetchByIds(params: TStreamPostsByIdsParams): Promise<NexusPostWithAttachmentMetadata[]> {
    const fetchChunk = async (chunk: string[]) => {
      const { url, body } = postStreamApi.postsByIds({ ...params, post_ids: chunk });
      return queryNexus<NexusPostWithAttachmentMetadata[]>({
        url,
        method: HttpMethod.POST,
        body: JSON.stringify(body),
      });
    };

    if (params.post_ids.length === 0) {
      return fetchChunk([]);
    }
    return fetchByIdsInChunks(params.post_ids, fetchChunk);
  }
}
