import { buildUrlWithQuery, encodePathSegment } from '@/services/nexus/nexus.utils';
import {
  SEARCH_PATH_PARAMS,
  type TTagPrefixSearchParams,
  type TTagSearchParams,
} from '@/services/nexus/search/search.types';

/**
 * Search API Endpoints
 *
 * All API endpoints related to search operations
 */

const PREFIX = 'v0/search';

export const searchApi = {
  byTag: (params: TTagSearchParams) => {
    const tag = encodePathSegment(params.tag);
    return buildUrlWithQuery({
      baseRoute: `${PREFIX}/posts/by_tag/${tag}`,
      params,
      excludeKeys: SEARCH_PATH_PARAMS,
    });
  },
  byPrefix: ({ version = 'v0', ...params }: TTagPrefixSearchParams) => {
    const prefix = encodePathSegment(params.prefix);
    return buildUrlWithQuery({
      baseRoute: `${version}/search/tags/by_prefix/${prefix}`,
      params,
      excludeKeys: SEARCH_PATH_PARAMS,
    });
  },
};
