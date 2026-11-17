/**
 * Icons for each issue type
 */
import {
  Baby,
  Ban,
  Briefcase,
  Copyright,
  Ellipsis,
  Flag,
  Frown,
  Hand,
  IdCard,
  MessageSquareWarning,
  ShieldAlert,
} from 'lucide-react';
import type { ReportReasonType } from '@/hooks/useReportPost/useReportPost.types';
import {
  REPORT_ISSUE_LABELS,
  REPORT_ISSUE_TYPE_VALUES,
  REPORT_ISSUE_TYPES,
  REVIEW_REPORT_ISSUE_LABELS,
  REVIEW_REPORT_ISSUE_TYPE_VALUES,
  REVIEW_REPORT_ISSUE_TYPES,
} from '@/pipes/report/report.constants';
import type { ReportIssueType, ReviewReportIssueType } from '@/pipes/report/report.types';
import type { DialogReportSubject } from '../DialogReportPost.types';

type IssueTypeIcon = React.ComponentType<{
  className?: string;
}>;

export const ISSUE_TYPE_ICONS: Record<ReportIssueType, IssueTypeIcon> = {
  [REPORT_ISSUE_TYPES.PERSONAL_INFO]: IdCard,
  [REPORT_ISSUE_TYPES.HATE_SPEECH]: Frown,
  [REPORT_ISSUE_TYPES.HARASSMENT]: Hand,
  [REPORT_ISSUE_TYPES.CHILD_ABUSE]: Baby,
  [REPORT_ISSUE_TYPES.TERRORISM]: Flag,
  [REPORT_ISSUE_TYPES.VIOLENCE]: ShieldAlert,
  [REPORT_ISSUE_TYPES.ILLEGAL_SALES]: Briefcase,
  [REPORT_ISSUE_TYPES.SEXUAL_CONTENT]: Ban,
  [REPORT_ISSUE_TYPES.COPYRIGHT]: Copyright,
};

export const REVIEW_ISSUE_TYPE_ICONS: Record<ReviewReportIssueType, IssueTypeIcon> = {
  [REVIEW_REPORT_ISSUE_TYPES.ILLEGAL_CONTENT]: ShieldAlert,
  [REVIEW_REPORT_ISSUE_TYPES.HATE_OR_HARASSMENT]: Frown,
  [REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW]: MessageSquareWarning,
  [REVIEW_REPORT_ISSUE_TYPES.PERSONAL_INFO]: IdCard,
  [REVIEW_REPORT_ISSUE_TYPES.OTHER]: Ellipsis,
};

export interface ReportIssueOption {
  value: ReportReasonType;
  label: string;
  Icon: IssueTypeIcon;
}

const POST_ISSUE_OPTIONS: ReportIssueOption[] = REPORT_ISSUE_TYPE_VALUES.map((value) => ({
  value,
  label: REPORT_ISSUE_LABELS[value],
  Icon: ISSUE_TYPE_ICONS[value],
}));

const REVIEW_ISSUE_OPTIONS: ReportIssueOption[] = REVIEW_REPORT_ISSUE_TYPE_VALUES.map((value) => ({
  value,
  label: REVIEW_REPORT_ISSUE_LABELS[value],
  Icon: REVIEW_ISSUE_TYPE_ICONS[value],
}));

/** The reasons the dialog offers: reviews have their own list; posts and listings share one. */
export const REPORT_ISSUE_OPTIONS: Record<DialogReportSubject, ReportIssueOption[]> = {
  post: POST_ISSUE_OPTIONS,
  listing: POST_ISSUE_OPTIONS,
  review: REVIEW_ISSUE_OPTIONS,
};
