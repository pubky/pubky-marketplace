import type { ReportIssueType, ReviewReportIssueType } from './report.types';

/**
 * Report-related constants
 *
 * Issue types for reporting posts, matching Pubky's implementation.
 */

/**
 * Report issue type identifiers
 */
export const REPORT_ISSUE_TYPES = {
  PERSONAL_INFO: 'personal-info',
  HATE_SPEECH: 'hate-speech',
  HARASSMENT: 'harassment',
  CHILD_ABUSE: 'child-abuse',
  TERRORISM: 'terrorism',
  VIOLENCE: 'violence',
  ILLEGAL_SALES: 'illegal-sales',
  SEXUAL_CONTENT: 'sexual-content',
  COPYRIGHT: 'copyright',
} as const;

/**
 * Report issue display labels (used in the report dialog UI and server-side,
 * e.g., Chatwoot messages)
 */
export const REPORT_ISSUE_LABELS: Record<ReportIssueType, string> = {
  [REPORT_ISSUE_TYPES.PERSONAL_INFO]: 'Personal Info Leak',
  [REPORT_ISSUE_TYPES.HATE_SPEECH]: 'Hate or Threatening Speech',
  [REPORT_ISSUE_TYPES.HARASSMENT]: 'Harassment or Targeted',
  [REPORT_ISSUE_TYPES.CHILD_ABUSE]: 'Child Sexual Abuse or Exploitation',
  [REPORT_ISSUE_TYPES.TERRORISM]: 'Promotion of Terrorist',
  [REPORT_ISSUE_TYPES.VIOLENCE]: 'Graphic or Criminal Violence',
  [REPORT_ISSUE_TYPES.ILLEGAL_SALES]: 'Illegal Sales or Criminal',
  [REPORT_ISSUE_TYPES.SEXUAL_CONTENT]: 'Non-consensual or Criminal Sexual Content',
  [REPORT_ISSUE_TYPES.COPYRIGHT]: 'Copyright Infringement',
};

/**
 * All valid issue type values as an array (for validation)
 */
export const REPORT_ISSUE_TYPE_VALUES = Object.values(REPORT_ISSUE_TYPES);

/**
 * Reason identifiers for reporting a marketplace review. Reviews have their
 * own list: "Fake or fraudulent review" has no post equivalent, and the post
 * list's criminal categories fold into "Illegal content".
 */
export const REVIEW_REPORT_ISSUE_TYPES = {
  ILLEGAL_CONTENT: 'illegal-content',
  HATE_OR_HARASSMENT: 'hate-or-harassment',
  FAKE_REVIEW: 'fake-review',
  PERSONAL_INFO: 'personal-information',
  OTHER: 'other',
} as const;

/** Review report reason labels, shown in the dialog and in the Reports inbox message. */
export const REVIEW_REPORT_ISSUE_LABELS: Record<ReviewReportIssueType, string> = {
  [REVIEW_REPORT_ISSUE_TYPES.ILLEGAL_CONTENT]: 'Illegal content',
  [REVIEW_REPORT_ISSUE_TYPES.HATE_OR_HARASSMENT]: 'Hate or harassment',
  [REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW]: 'Fake or fraudulent review',
  [REVIEW_REPORT_ISSUE_TYPES.PERSONAL_INFO]: 'Personal information',
  [REVIEW_REPORT_ISSUE_TYPES.OTHER]: 'Other',
};

/** Review report reasons in display order. */
export const REVIEW_REPORT_ISSUE_TYPE_VALUES = Object.values(REVIEW_REPORT_ISSUE_TYPES);

/**
 * Maximum character length for report reason text
 */
export const REPORT_REASON_MAX_LENGTH = 1000;
