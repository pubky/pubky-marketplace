import type { REPORT_ISSUE_TYPES } from './report.constants';

/**
 * Report issue type
 */
/** The listing a report is about, carried alongside the listing URL. */
export interface ReportListingReference {
  listingId: string;
  sellerPubky: string;
}

export type ReportIssueType = (typeof REPORT_ISSUE_TYPES)[keyof typeof REPORT_ISSUE_TYPES];
