import type { REPORT_ISSUE_TYPES, REVIEW_REPORT_ISSUE_TYPES } from './report.constants';

/** The listing a report is about, carried alongside the listing URL. */
export interface ReportListingReference {
  listingId: string;
  sellerPubky: string;
}

/**
 * The marketplace review a report is about: the review record's URI, its
 * author, and the listing it reviews (shown at the reported URL).
 */
export interface ReportReviewReference extends ReportListingReference {
  reviewUri: string;
  reviewerPubky: string;
}

/** Reason for reporting a post or a listing. */
export type ReportIssueType = (typeof REPORT_ISSUE_TYPES)[keyof typeof REPORT_ISSUE_TYPES];

/** Reason for reporting a marketplace review. */
export type ReviewReportIssueType = (typeof REVIEW_REPORT_ISSUE_TYPES)[keyof typeof REVIEW_REPORT_ISSUE_TYPES];
