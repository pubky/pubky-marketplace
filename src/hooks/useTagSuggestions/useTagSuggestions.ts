'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { debounce } from 'lodash-es';
import { SearchController } from '@/controllers/search/search';
import { Logger } from '@/libs/logger/logger';
import { normalizeLegacyTagLabel, normalizeSocialTagLabel } from '@/libs/tag-label';
import {
  TAG_SUGGESTIONS_DEBOUNCE_MS,
  TAG_SUGGESTIONS_DEFAULT_LIMIT,
  TAG_SUGGESTIONS_MIN_QUERY_LENGTH,
} from './useTagSuggestions.constants';
import type { UseTagSuggestionsParams, UseTagSuggestionsResult } from './useTagSuggestions.types';

/**
 * Hook for fetching tag suggestions from the API
 *
 * Features:
 * - Debounced API calls to avoid excessive requests
 * - Filters out excluded tags (e.g., already added tags)
 * - Handles stale responses from out-of-order async calls
 * - Graceful error handling
 */
export function useTagSuggestions({
  query,
  excludeTags = [],
  normalizeLabel = normalizeLegacyTagLabel,
  enabled = true,
  limit = TAG_SUGGESTIONS_DEFAULT_LIMIT,
}: UseTagSuggestionsParams): UseTagSuggestionsResult {
  const [rawSuggestions, setRawSuggestions] = useState<string[]>([]);
  const [, setIsLoading] = useState(false);
  // Guards against out-of-order async responses overwriting newer results
  const requestIdRef = useRef(0);

  // Memoize excludeTags set for efficient filtering
  const excludeTagsSet = useMemo(() => new Set(excludeTags.map(normalizeLabel)), [excludeTags, normalizeLabel]);

  // Filter suggestions to remove excluded tags
  const suggestions = useMemo(
    () => rawSuggestions.filter((tag) => !excludeTagsSet.has(normalizeLabel(tag))),
    [rawSuggestions, excludeTagsSet, normalizeLabel],
  );

  // Debounced search function
  const debouncedSearchRef = useRef(
    debounce(async (searchQuery: string, searchLimit: number, v1: boolean) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);

      try {
        const results = await SearchController.getTagsByPrefix({
          prefix: searchQuery,
          limit: searchLimit,
          ...(v1 ? { version: 'v1' as const } : {}),
        });

        // If a newer request started while we awaited, ignore stale results
        if (requestId !== requestIdRef.current) {
          return;
        }

        setRawSuggestions(results);
      } catch (error) {
        Logger.error('[useTagSuggestions] Failed to fetch tag suggestions:', error);
        if (requestId === requestIdRef.current) {
          setRawSuggestions([]);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, TAG_SUGGESTIONS_DEBOUNCE_MS),
  );

  // Cleanup debounced function on unmount to prevent memory leaks
  useEffect(() => {
    const debouncedFn = debouncedSearchRef.current;
    return () => {
      debouncedFn.cancel();
    };
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();

    // Reset if disabled, empty query, or below minimum length
    if (!enabled || !trimmedQuery || trimmedQuery.length < TAG_SUGGESTIONS_MIN_QUERY_LENGTH) {
      debouncedSearchRef.current.cancel(); // Cancel first to prevent race conditions
      requestIdRef.current += 1; // Then invalidate any in-flight request
      setRawSuggestions([]);
      setIsLoading(false);
      return;
    }

    // Trigger debounced search
    const debouncedFn = debouncedSearchRef.current;
    debouncedFn(trimmedQuery, limit, normalizeLabel === normalizeSocialTagLabel);

    // Cleanup: cancel pending debounced calls when deps change
    return () => {
      debouncedFn.cancel();
    };
  }, [query, enabled, limit, normalizeLabel]);

  return {
    suggestions,
  };
}
