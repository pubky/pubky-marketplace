import { queryNexus } from '@/services/nexus/nexus.utils';
import { searchApi } from '@/services/nexus/search/search.api';
import type { TSearchResult, TTagPrefixSearchParams } from '@/services/nexus/search/search.types';

/**
 * Nexus Search Service
 *
 * Handles search operations against the Nexus API
 */
export class NexusSearchService {
  private constructor() {}

  /**
   * Search tags by prefix
   *
   * @param params - Parameters containing prefix and pagination options
   * @returns Array of tag labels matching the prefix
   */
  static async tags(params: TTagPrefixSearchParams): Promise<TSearchResult> {
    const url = searchApi.byPrefix(params);
    return await queryNexus<TSearchResult>({ url });
  }
}
