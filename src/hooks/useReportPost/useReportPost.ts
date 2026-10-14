'use client';

import { useCallback, useState } from 'react';
import { getMarketplaceListingRoute, POST_ROUTES } from '@/app/routes';
import { withPublicPath } from '@/config/base-path';
import { useCurrentUserProfile } from '@/hooks/useCurrentUserProfile/useCurrentUserProfile';
import { postJson } from '@/libs/api/client-request';
import { Logger } from '@/libs/logger/logger';
import { parseCompositeId } from '@/models/models.utils';
import { toast } from '@/molecules/Toaster/use-toast';
import type { ReportIssueType } from '@/pipes/report/report.types';
import { REPORT_API_ENDPOINT, REPORT_POST_STEPS } from './useReportPost.constants';
import type { ReportPostStep, ReportTarget, UseReportPostReturn } from './useReportPost.types';

/**
 * Hook to handle post and listing reporting to Chatwoot.
 *
 * Manages the two-step reporting flow:
 * 1. Issue selection - user selects the type of issue
 * 2. Reason input - user provides detailed description
 *
 * A listing report posts the listing URL together with the listing id and the
 * seller pubky, so moderators can find the listing without parsing the URL.
 *
 * @param target - The post (composite ID "author:postId") or listing being reported
 * @returns Report state and handlers
 */
export function useReportPost(target: ReportTarget): UseReportPostReturn {
  const { currentUserPubky, userDetails } = useCurrentUserProfile();
  const reportedUrl = buildReportedUrl(target);
  const listingPayload =
    target.kind === 'listing' ? { listingId: target.listingId, sellerPubky: target.sellerPubky } : {};
  // A listing report falls back to the reporter's pubky when no profile name
  // has loaded, so a missing display name never blocks it.
  const reporterName = userDetails?.name || (target.kind === 'listing' ? currentUserPubky : undefined);

  const [step, setStep] = useState<ReportPostStep>(REPORT_POST_STEPS.ISSUE_SELECTION);
  const [selectedIssueType, setSelectedIssueType] = useState<ReportIssueType | null>(null);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const selectIssueType = (issueType: ReportIssueType) => {
    setSelectedIssueType(issueType);
    setStep(REPORT_POST_STEPS.REASON_INPUT);
  };

  const handleReasonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReason(e.target.value);
  };

  const submit = async () => {
    const trimmedReason = reason.trim();
    const canSubmit = trimmedReason && selectedIssueType && !isSubmitting;

    if (!canSubmit) return;

    if (!currentUserPubky || !reporterName) {
      toast({ variant: 'error', description: 'Could not load profile' });
      return;
    }

    setIsSubmitting(true);

    try {
      await postJson(REPORT_API_ENDPOINT, {
        pubky: currentUserPubky,
        postUrl: reportedUrl,
        issueType: selectedIssueType,
        reason: trimmedReason,
        name: reporterName,
        ...listingPayload,
      });

      setIsSuccess(true);
    } catch (err) {
      Logger.error('Error submitting report:', err);
      toast({
        variant: 'error',
        description: err instanceof Error ? err.message : 'Could not submit report. Try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = useCallback(() => {
    setStep(REPORT_POST_STEPS.ISSUE_SELECTION);
    setSelectedIssueType(null);
    setReason('');
    setIsSubmitting(false);
    setIsSuccess(false);
  }, []);

  const hasContent = reason.trim().length > 0;

  return {
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
  };
}

function buildReportedUrl(target: ReportTarget): string {
  if (target.kind === 'listing') {
    return `${window.location.origin}${withPublicPath(getMarketplaceListingRoute(target.sellerPubky, target.listingId))}`;
  }
  const parsedId = parseCompositeId(target.postId);
  return `${window.location.origin}${withPublicPath(POST_ROUTES.POST)}/${parsedId.pubky}/${parsedId.id}`;
}
