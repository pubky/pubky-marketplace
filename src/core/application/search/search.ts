import { NexusSearchService } from '@/services/nexus/search/search';
import type { TSearchResult, TTagPrefixSearchParams } from '@/services/nexus/search/search.types';

/**
 * Search Application Layer
 *
 * Orchestrates search operations between controllers and services.
 */
export class SearchApplication {
  private constructor() {}

  /**
   * Search tags by prefix
   */
  static async fetchTagsByPrefix(params: TTagPrefixSearchParams): Promise<TSearchResult> {
    return await NexusSearchService.tags(params);
  }
}
