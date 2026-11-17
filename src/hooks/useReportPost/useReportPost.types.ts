import type { ReportIssueType, ReviewReportIssueType } from '@/pipes/report/report.types';
import { REPORT_POST_STEPS } from './useReportPost.constants';

/**
 * What a report is about: a post (composite id `author:postId`), a
 * marketplace listing (seller pubky and the seller-scoped listing id), or a
 * marketplace review (its URI and author, and the listing it reviews).
 */
export type ReportTarget =
  | { kind: 'post'; postId: string }
  | { kind: 'listing'; sellerPubky: string; listingId: string }
  | { kind: 'review'; reviewUri: string; reviewerPubky: string; sellerPubky: string; listingId: string };

/** A reason the report dialog offers: the post and listing list, or the review list. */
export type ReportReasonType = ReportIssueType | ReviewReportIssueType;

export type ReportPostStep = (typeof REPORT_POST_STEPS)[keyof typeof REPORT_POST_STEPS];

/**
 * Return type of useReportPost hook
 */
export interface UseReportPostReturn {
  /** Current step in the report flow */
  step: ReportPostStep;
  /** Selected issue type, null if not selected */
  selectedIssueType: ReportReasonType | null;
  /** Reason text entered by user */
  reason: string;
  /** True while submission is in progress */
  isSubmitting: boolean;
  /** True after successful submission */
  isSuccess: boolean;
  /** True if reason has non-whitespace content */
  hasContent: boolean;
  /** Select an issue type and advance to reason step */
  selectIssueType: (issueType: ReportReasonType) => void;
  /** Handler for reason textarea onChange */
  handleReasonChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Submit the report */
  submit: () => Promise<void>;
  /** Reset all state to initial values */
  reset: () => void;
}
