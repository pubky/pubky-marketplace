'use client';

import { Mail } from 'lucide-react';
import { listingUriBuilder } from 'pubky-app-specs';
import { Button } from '@/atoms/Button/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import { COMPLAINT_EMAIL } from '@/config/legal';
import { useSellerHostedBySynonym } from '@/hooks/useSellerHostedBySynonym/useSellerHostedBySynonym';
import { ChatEntryButton } from '@/organisms/Chat/ChatEntryButton';

/** Synonym's complaint email, with the listing's record URI in the subject the Terms ask for. */
export function storeListingNoticeHref(sellerPubky: string, listingId: string): string {
  const subject = `Complaint: listing ${listingUriBuilder(sellerPubky, listingId)}`;
  return `mailto:${COMPLAINT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

interface StoreReportListingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sellerPubky: string;
  listingId: string;
}

/**
 * Report listing in a store, which reaches no Market support desk. The buyer tells the seller in chat,
 * the seller's only contact a store knows. When the seller's records sit on one of Synonym's
 * homeservers, Synonym hosts the listing, so the dialog also offers its notice route for hosted
 * content: the complaint email its Terms of Service name.
 */
export function StoreReportListingDialog({
  open,
  onOpenChange,
  sellerPubky,
  listingId,
}: StoreReportListingDialogProps) {
  const hostedBySynonym = useSellerHostedBySynonym(sellerPubky, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-xl"
        data-testid="store-report-listing-dialog"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Report listing</DialogTitle>
          <DialogDescription>
            This store is run by its seller. Tell them what is wrong with this listing.
          </DialogDescription>
        </DialogHeader>
        <ChatEntryButton
          peerPubky={sellerPubky}
          context={{ listingId }}
          label="Message the seller"
          className="justify-self-start rounded-full"
          dataTestId="store-report-message-seller"
        />
        {hostedBySynonym === null && (
          <Typography as="p" size="sm" className="text-muted-foreground" data-testid="store-report-hosting-pending">
            Checking where this seller&apos;s records are hosted…
          </Typography>
        )}
        {hostedBySynonym && (
          <section aria-label="Notice to Synonym" className="flex flex-col gap-2 border-t border-border pt-4">
            <Typography as="h3" size="sm" className="font-semibold">
              Illegal content
            </Typography>
            <Typography as="p" size="sm" className="text-muted-foreground">
              Synonym hosts this seller&apos;s records on its homeserver. If you believe this listing is illegal, you
              can also send Synonym a notice at {COMPLAINT_EMAIL}.
            </Typography>
            <Button asChild variant="secondary" size="sm" className="self-start rounded-full">
              <a href={storeListingNoticeHref(sellerPubky, listingId)} data-testid="store-report-synonym-notice">
                <Mail className="size-4" aria-hidden="true" />
                Email Synonym a notice
              </a>
            </Button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
