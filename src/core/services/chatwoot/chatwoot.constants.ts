/**
 * Chatwoot service constants
 *
 * Inbox IDs and message prefixes for Chatwoot API integration.
 */

/**
 * Chatwoot Inbox IDs
 *
 * Different inboxes for different submission types.
 * These map to Chatwoot inbox configurations.
 */
export const CHATWOOT_INBOX_IDS = {
  FEEDBACK: 26,
  REPORTS: 27,
  /** Reserved for future copyright infringement reports */
  COPYRIGHT: 28,
} as const;

/**
 * Message prefix for feedback submissions
 */
export const CHATWOOT_FEEDBACK_MESSAGE_PREFIX = 'Feedback';

/**
 * Message prefix for report submissions
 */
export const CHATWOOT_REPORT_MESSAGE_PREFIX = 'Report Post';

/**
 * Message prefix for listing report submissions
 */
export const CHATWOOT_REPORT_LISTING_MESSAGE_PREFIX = 'Report Listing';

/**
 * Message prefix for marketplace review report submissions
 */
export const CHATWOOT_REPORT_REVIEW_MESSAGE_PREFIX = 'Report Review';

/**
 * Label for the submitter's pubky in a support message. The pubky comes from
 * the request body and is not checked against a session, so it is a claim.
 */
export const CHATWOOT_CLAIMED_REPORTER_LABEL = 'Reporter (claimed, unverified)';

/**
 * Label for the submitter's display name in a support message. The name comes
 * from the request body and is not checked against a session, so it is a claim.
 */
export const CHATWOOT_CLAIMED_NAME_LABEL = 'Name (claimed, unverified)';
