import { useRouter } from 'next/navigation';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent } from '@/atoms/Dialog/Dialog';
import { REPORT_ISSUE_LABELS, REPORT_ISSUE_TYPES, REVIEW_REPORT_ISSUE_TYPES } from '@/pipes/report/report.constants';
import { DialogReportPostIssueStep } from './DialogReportPostIssueStep';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

const renderWithDialog = (component: React.ReactElement) => {
  return render(
    <Dialog open={true}>
      <DialogContent>{component}</DialogContent>
    </Dialog>,
  );
};

describe('DialogReportPostIssueStep', () => {
  const mockOnSelectIssueType = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnOpenChange = vi.fn();
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof useRouter>);
  });

  it('renders with correct title and description', () => {
    renderWithDialog(<DialogReportPostIssueStep onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />);

    expect(screen.getByText('Report Post')).toBeInTheDocument();
    expect(screen.getByText('What sort of issue are you reporting?')).toBeInTheDocument();
  });

  it('titles the step Report Listing for a listing report and offers the same reasons', () => {
    renderWithDialog(
      <DialogReportPostIssueStep subject="listing" onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />,
    );

    expect(screen.getByText('Report Listing')).toBeInTheDocument();
    expect(screen.getByText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.ILLEGAL_SALES])).toBeInTheDocument();
    expect(screen.getByText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.COPYRIGHT])).toBeInTheDocument();
  });

  it('titles the step Report Review for a review and offers only the review reasons, in order', async () => {
    const user = userEvent.setup();
    renderWithDialog(
      <DialogReportPostIssueStep subject="review" onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />,
    );

    expect(screen.getByText('Report Review')).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual([
      'Illegal content',
      'Hate or harassment',
      'Fake or fraudulent review',
      'Personal information',
      'Other',
    ]);
    expect(screen.queryByText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.COPYRIGHT])).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Fake or fraudulent review'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockOnSelectIssueType).toHaveBeenCalledWith(REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW);
  });

  it('renders all issue type options', () => {
    renderWithDialog(<DialogReportPostIssueStep onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />);

    Object.values(REPORT_ISSUE_TYPES).forEach((issueType) => {
      const label = REPORT_ISSUE_LABELS[issueType];
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('calls onSelectIssueType with correct issue type when Next button is clicked after selecting issue', async () => {
    const user = userEvent.setup();
    renderWithDialog(<DialogReportPostIssueStep onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />);

    // First select an issue type
    const firstIssueButton = screen.getByLabelText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.PERSONAL_INFO]);
    await user.click(firstIssueButton);

    // Then click Next button (translated to "Next" from common.next)
    const nextButton = screen.getByRole('button', { name: 'Next' });
    await user.click(nextButton);

    expect(mockOnSelectIssueType).toHaveBeenCalledWith(REPORT_ISSUE_TYPES.PERSONAL_INFO);
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderWithDialog(<DialogReportPostIssueStep onSelectIssueType={mockOnSelectIssueType} onCancel={mockOnCancel} />);

    // Cancel button (translated to "Cancel" from common.cancel)
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('redirects to /copyright and closes dialog when copyright infringement is selected and Next is clicked', async () => {
    const user = userEvent.setup();
    renderWithDialog(
      <DialogReportPostIssueStep
        onSelectIssueType={mockOnSelectIssueType}
        onCancel={mockOnCancel}
        onOpenChange={mockOnOpenChange}
      />,
    );

    // Select copyright infringement
    const copyrightButton = screen.getByLabelText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.COPYRIGHT]);
    await user.click(copyrightButton);

    // Click Next button (translated to "Next" from common.next)
    const nextButton = screen.getByRole('button', { name: 'Next' });
    await user.click(nextButton);

    // Should close dialog and redirect to /copyright
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    expect(mockPush).toHaveBeenCalledWith('/copyright');
    // Should NOT call onSelectIssueType for copyright
    expect(mockOnSelectIssueType).not.toHaveBeenCalled();
  });

  it('does not redirect when non-copyright issue is selected', async () => {
    const user = userEvent.setup();
    renderWithDialog(
      <DialogReportPostIssueStep
        onSelectIssueType={mockOnSelectIssueType}
        onCancel={mockOnCancel}
        onOpenChange={mockOnOpenChange}
      />,
    );

    // Select a non-copyright issue
    const personalInfoButton = screen.getByLabelText(REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.PERSONAL_INFO]);
    await user.click(personalInfoButton);

    // Click Next button (translated to "Next" from common.next)
    const nextButton = screen.getByRole('button', { name: 'Next' });
    await user.click(nextButton);

    // Should call onSelectIssueType normally
    expect(mockOnSelectIssueType).toHaveBeenCalledWith(REPORT_ISSUE_TYPES.PERSONAL_INFO);
    // Should NOT redirect or close dialog
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockOnOpenChange).not.toHaveBeenCalled();
  });
});
