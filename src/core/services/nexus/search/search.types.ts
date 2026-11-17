import type { StreamSorting, TPaginationParams, TPaginationRangeParams } from '@/services/nexus/nexus.types';

export type TTagParams = TPaginationParams & {
  tag: string;
};

export type TTagSearchParams = TTagParams &
  TPaginationRangeParams & {
    sorting?: StreamSorting;
  };

export type TPrefixSearchParams = TPaginationParams & {
  prefix: string;
};

// Common return type for search results (array of IDs/labels)
export type TSearchResult = string[];

// Path parameters that should NOT be added to query string
export const SEARCH_PATH_PARAMS = ['tag', 'prefix'] as const;
