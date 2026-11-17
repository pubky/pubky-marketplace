'use client';

import { useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { useReportPost } from '@/hooks/useReportPost/useReportPost';
import { REPORT_POST_STEPS } from '@/hooks/useReportPost/useReportPost.constants';
import type { ReportTarget } from '@/hooks/useReportPost/useReportPost.types';
import { REPORT_SUBJECT_TITLES } from './DialogReportPost.constants';
import type { DialogReportPostProps } from './DialogReportPost.types';
import { DialogReportPostIssueStep } from './DialogReportPostIssueStep/DialogReportPostIssueStep';
import { DialogReportPostReasonStep } from './DialogReportPostReasonStep/DialogReportPostReasonStep';
import { DialogReportPostSuccess } from './DialogReportPostSuccess/DialogReportPostSuccess';

export function DialogReportPost({ open, onOpenChange, postId, listing, review }: DialogReportPostProps) {
  const target: ReportTarget = review
    ? { kind: 'review', ...review }
    : listing
      ? { kind: 'listing', sellerPubky: listing.sellerPubky, listingId: listing.listingId }
      : { kind: 'post', postId };
  const subject = target.kind;
  const subjectTitle = REPORT_SUBJECT_TITLES[subject];
  const {
    step,
    selectedIssueType,
    reason,
    isSubmitting,
    isSuccess,
    hasContent,
    selectIssueType,
    handleReasonChange,
    submit,
    reset,
  } = useReportPost(target);

  // Reset state when the dialog closes
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const handleCancel = () => {
    onOpenChange(false);
  };

  const renderContent = () => {
    if (isSuccess) {
      return <DialogReportPostSuccess onOpenChange={onOpenChange} />;
    }

    if (step === REPORT_POST_STEPS.REASON_INPUT && selectedIssueType !== null) {
      return (
        <DialogReportPostReasonStep
          subject={subject}
          reason={reason}
          hasContent={hasContent}
          isSubmitting={isSubmitting}
          onReasonChange={handleReasonChange}
          onCancel={handleCancel}
          onSubmit={submit}
        />
      );
    }

    return (
      <DialogReportPostIssueStep
        subject={subject}
        onSelectIssueType={selectIssueType}
        onCancel={handleCancel}
        onOpenChange={onOpenChange}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-xl" hiddenTitle={subjectTitle} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="sr-only">{subjectTitle}</DialogTitle>
          <DialogDescription className="sr-only">{`Report ${subject} dialog`}</DialogDescription>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
