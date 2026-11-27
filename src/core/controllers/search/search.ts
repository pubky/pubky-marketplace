import { SearchApplication } from '@/application/search/search';
import type { TSearchResult, TTagPrefixSearchParams } from '@/services/nexus/search/search.types';

export class SearchController {
  private constructor() {}

  /**
   * Search tags by prefix
   */
  static async getTagsByPrefix(params: TTagPrefixSearchParams): Promise<TSearchResult> {
    return await SearchApplication.fetchTagsByPrefix(params);
  }
}
