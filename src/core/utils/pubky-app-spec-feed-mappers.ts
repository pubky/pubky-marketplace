/**
 * Pubky App Spec Feed Mappers
 *
 * This utility provides bidirectional mapping between:
 * - Source 1: pubky-app-specs enums (node_modules/pubky-app-specs/pubky_app_specs.d.ts)
 *   - PubkyAppFeedLayout, PubkyAppFeedReach, PubkyAppFeedSort, PubkyAppPostKind
 * - Source 2: Home store types (src/core/stores/home/home.types.ts)
 *   - LAYOUT, REACH, SORT, CONTENT
 *
 * Purpose: Enable conversion between the external pubky-app-specs format and
 * the internal home store representation used throughout the application.
 *
 * Note: Some values don't have direct mappings and will return undefined:
 * - PubkyAppFeedReach.Followers has no home type equivalent
 * - CONTENT.ALL has no PubkyAppPostKind equivalent
 */

import { PubkyAppFeedLayout, PubkyAppFeedReach, PubkyAppFeedSort, PubkyAppPostKind } from 'pubky-app-specs';
import {
  CONTENT,
  type ContentType,
  LAYOUT,
  type LayoutType,
  REACH,
  type ReachType,
  SORT,
  type SortType,
} from '@/stores/home/home.types';

// ============================================================================
// Layout Mappers
// ============================================================================

/**
 * Maps PubkyAppFeedLayout enum to home LayoutType
 */
export function pubkyLayoutToHomeLayout(layout: PubkyAppFeedLayout): LayoutType | undefined {
  switch (layout) {
    case PubkyAppFeedLayout.Columns:
      return LAYOUT.COLUMNS;
    case PubkyAppFeedLayout.Wide:
      return LAYOUT.WIDE;
    case PubkyAppFeedLayout.List:
      return LAYOUT.LIST;
    case PubkyAppFeedLayout.Visual:
      return LAYOUT.VISUAL;
    default:
      return undefined;
  }
}

// ============================================================================
// Reach Mappers
// ============================================================================

/**
 * Maps PubkyAppFeedReach enum to home ReachType
 * Note: PubkyAppFeedReach.Followers has no home equivalent and returns undefined
 */
export function pubkyReachToHomeReach(reach: PubkyAppFeedReach): ReachType | undefined {
  switch (reach) {
    case PubkyAppFeedReach.Following:
      return REACH.FOLLOWING;
    case PubkyAppFeedReach.Friends:
      return REACH.FRIENDS;
    case PubkyAppFeedReach.All:
      return REACH.ALL;
    case PubkyAppFeedReach.Wot:
      return REACH.NETWORK;
    case PubkyAppFeedReach.Me:
      return REACH.ME;
    case PubkyAppFeedReach.Followers:
      // No home type equivalent for Followers
      return undefined;
    default:
      return undefined;
  }
}

// ============================================================================
// Sort Mappers
// ============================================================================

/**
 * Maps PubkyAppFeedSort enum to home SortType
 */
export function pubkySortToHomeSort(sort: PubkyAppFeedSort): SortType | undefined {
  switch (sort) {
    case PubkyAppFeedSort.Recent:
      return SORT.TIMELINE;
    case PubkyAppFeedSort.Popularity:
      return SORT.ENGAGEMENT;
    default:
      return undefined;
  }
}

// ============================================================================
// Content/PostKind Mappers
// ============================================================================

/**
 * Maps PubkyAppPostKind enum to home ContentType
 */
export function pubkyPostKindToHomeContent(postKind: PubkyAppPostKind): ContentType | undefined {
  switch (postKind) {
    case PubkyAppPostKind.Short:
      return CONTENT.SHORT;
    case PubkyAppPostKind.Long:
      return CONTENT.LONG;
    case PubkyAppPostKind.Image:
      return CONTENT.IMAGES;
    case PubkyAppPostKind.Video:
      return CONTENT.VIDEOS;
    case PubkyAppPostKind.Link:
      return CONTENT.LINKS;
    case PubkyAppPostKind.File:
      return CONTENT.FILES;
    case PubkyAppPostKind.Collection:
      return CONTENT.COLLECTIONS;
    default:
      return undefined;
  }
}
