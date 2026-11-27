/**
 * Tag-related display configuration constants
 *
 * These are display/truncation limits, not validation limits.
 * For input validation limits, see posts.ts (TAG_MAX_LENGTH for max input length)
 */

// =============================================================================
// User List Item Display (Followers, Following, Active Users, Participants)
// =============================================================================

/** Maximum characters per tag before truncation in user list items */
export const USER_LIST_TAG_MAX_LENGTH = 8;

/** Maximum total characters across all displayed tags in user list items */
export const USER_LIST_TAGS_MAX_TOTAL_CHARS = 20;

// =============================================================================
// Clickable Tags List Display (Default values, can be overridden via props)
// =============================================================================

/** Default maximum characters per tag before truncation in clickable tags list */
export const CLICKABLE_TAGS_DEFAULT_MAX_LENGTH = 8;

/** Default maximum total characters across all displayed tags in clickable tags list */
export const CLICKABLE_TAGS_DEFAULT_MAX_TOTAL_CHARS = 20;

// =============================================================================
// Tag Input Layout
// =============================================================================

/** Tag input width in pixels when user can still add more tags */
export const TAG_INPUT_WIDTH_DEFAULT = 130;

/** Tag input width in pixels when max tags limit is reached */
export const TAG_INPUT_WIDTH_AT_LIMIT = 162;
