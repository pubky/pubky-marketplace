'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import type { ReportReasonType } from '@/hooks/useReportPost/useReportPost.types';
import { cn } from '@/libs/utils/utils';
import { REPORT_ISSUE_TYPES } from '@/pipes/report/report.constants';
import { REPORT_SUBJECT_TITLES } from '../DialogReportPost.constants';
import { REPORT_ISSUE_OPTIONS } from './DialogReportPostIssueStep.constants';
import type { DialogReportPostIssueStepProps } from './DialogReportPostIssueStep.types';

export function DialogReportPostIssueStep({
  subject = 'post',
  onSelectIssueType,
  onCancel,
  onOpenChange,
}: DialogReportPostIssueStepProps) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<ReportReasonType | null>(null);
  const handleSelect = (issueType: ReportReasonType) => {
    setSelectedType(issueType);
  };
  const handleNext = () => {
    if (!selectedType) return;

    // If copyright infringement is selected, redirect to /copyright page
    if (selectedType === REPORT_ISSUE_TYPES.COPYRIGHT) {
      onOpenChange?.(false);
      router.push('/copyright');
      return;
    }

    // Otherwise, proceed with normal flow
    onSelectIssueType(selectedType);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{REPORT_SUBJECT_TITLES[subject]}</DialogTitle>
        <DialogDescription>{'What sort of issue are you reporting?'}</DialogDescription>
      </DialogHeader>

      <Container className="gap-1 py-2" role="listbox" aria-label={'Issue types'}>
        {REPORT_ISSUE_OPTIONS[subject].map(({ value: issueType, label, Icon }) => {
          const isSelected = selectedType === issueType;
          return (
            <Button
              key={issueType}
              data-cy={`report-issue-${issueType}`}
              variant="ghost"
              role="option"
              aria-selected={isSelected}
              aria-label={label}
              className={cn(
                'h-auto w-full justify-start gap-3 rounded-lg px-3 py-3 hover:bg-muted',
                isSelected && 'bg-muted',
              )}
              onClick={() => handleSelect(issueType)}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Typography as="span" size="sm" className="flex-1 text-left text-foreground">
                {label}
              </Typography>
              {isSelected && <Check className="size-5 shrink-0 text-foreground" aria-hidden="true" />}
            </Button>
          );
        })}
      </Container>

      <DialogFooter>
        <Button
          data-cy="report-issue-step-cancel"
          variant="secondary"
          size="lg"
          onClick={onCancel}
          aria-label={'Cancel'}
        >
          {'Cancel'}
        </Button>
        <Button
          data-cy="report-issue-step-next"
          variant="dark-outline"
          size="lg"
          onClick={handleNext}
          disabled={!selectedType}
          aria-label={'Next'}
        >
          {'Next'}
        </Button>
      </DialogFooter>
    </>
  );
}
