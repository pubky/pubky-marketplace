import type { Pubky } from '@/models/models.types';
import type { ReportIssueType, ReportListingReference } from '@/pipes/report/report.types';

export interface TReportSubmitInput {
  pubky: Pubky;
  postUrl: string;
  issueType: ReportIssueType;
  reason: string;
  name: string;
  /** Set when the report is about a listing; `postUrl` then holds the listing URL. */
  listing?: ReportListingReference;
}
