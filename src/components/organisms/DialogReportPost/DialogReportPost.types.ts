interface DialogReportBaseProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Handler for dialog open state changes */
  onOpenChange: (open: boolean) => void;
}

/** Reports a post. */
interface DialogReportPostTargetProps extends DialogReportBaseProps {
  /** Composite post ID in format "author:postId" */
  postId: string;
  listing?: never;
  review?: never;
}

/** Reports a marketplace listing. */
interface DialogReportListingTargetProps extends DialogReportBaseProps {
  /** The listing being reported */
  listing: { sellerPubky: string; listingId: string };
  postId?: never;
  review?: never;
}

/** Reports a marketplace review. */
interface DialogReportReviewTargetProps extends DialogReportBaseProps {
  /** The review being reported: its URI and author, and the listing it reviews */
  review: { reviewUri: string; reviewerPubky: string; sellerPubky: string; listingId: string };
  postId?: never;
  listing?: never;
}

export type DialogReportPostProps =
  | DialogReportPostTargetProps
  | DialogReportListingTargetProps
  | DialogReportReviewTargetProps;

/** What the dialog copy calls the thing being reported. */
export type DialogReportSubject = 'post' | 'listing' | 'review';
