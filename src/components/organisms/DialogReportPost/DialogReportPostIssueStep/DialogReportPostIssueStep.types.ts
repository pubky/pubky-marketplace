import type { ReportReasonType } from '@/hooks/useReportPost/useReportPost.types';
import type { DialogReportSubject } from '../DialogReportPost.types';

export interface DialogReportPostIssueStepProps {
  /** What is being reported; drives the title and the reasons offered. Defaults to a post. */
  subject?: DialogReportSubject;
  /** Handler when an issue type is selected and Next is clicked */
  onSelectIssueType: (issueType: ReportReasonType) => void;
  /** Handler when Cancel is clicked */
  onCancel: () => void;
  /** Optional handler to close the dialog (needed for copyright redirect) */
  onOpenChange?: (open: boolean) => void;
}
