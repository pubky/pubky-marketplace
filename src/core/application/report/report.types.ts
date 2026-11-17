import type { Pubky } from '@/models/models.types';
import type {
  ReportIssueType,
  ReportListingReference,
  ReportReviewReference,
  ReviewReportIssueType,
} from '@/pipes/report/report.types';

interface TReportSubmitBase {
  pubky: Pubky;
  postUrl: string;
  reason: string;
  name: string;
}

/** A post report, or a listing report when `listing` is set (`postUrl` then holds the listing URL). */
export interface TReportPostOrListingSubmitInput extends TReportSubmitBase {
  issueType: ReportIssueType;
  listing?: ReportListingReference;
  review?: never;
}

/** A marketplace review report; `postUrl` holds the URL of the reviewed listing's page. */
export interface TReportReviewSubmitInput extends TReportSubmitBase {
  issueType: ReviewReportIssueType;
  review: ReportReviewReference;
  listing?: never;
}

export type TReportSubmitInput = TReportPostOrListingSubmitInput | TReportReviewSubmitInput;
