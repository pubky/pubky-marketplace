'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, PencilLine, Store, Trash2 } from 'lucide-react';
import { getMarketplaceListingEditRoute, getMarketplaceListingRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useDeleteMarketplaceListings } from '@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings';
import { useEditMarketplaceListing } from '@/hooks/useEditMarketplaceListing/useEditMarketplaceListing';
import { useListingStoreSync } from '@/hooks/useListingStoreSync/useListingStoreSync';
import { ListingPublishGuardNotice } from '@/molecules/Marketplace/ListingPublishGuardNotice';
import { MarketplaceContentLayout } from '@/organisms/Marketplace/MarketplaceContentLayout';
import { MarketplaceListingDeleteDialog } from '@/organisms/Marketplace/MarketplaceListingDeleteDialog';
import { MarketplaceListingForm } from '@/organisms/Marketplace/MarketplaceListingForm';
import { MarketplaceSkeleton } from './Marketplace.skeleton';

export interface MarketplaceEditListingProps {
  sellerPubky: string;
  listingId: string;
}

export function MarketplaceEditListing({ sellerPubky, listingId }: MarketplaceEditListingProps) {
  const router = useRouter();
  const editing = useEditMarketplaceListing(sellerPubky, listingId);
  const storeSync = useListingStoreSync(listingId);
  const [isSaving, setIsSaving] = useState(false);
  const listingRoute = getMarketplaceListingRoute(sellerPubky, listingId);
  const deleting = useDeleteMarketplaceListings({ onDeleted: () => router.push(MARKETPLACE_ROUTES.DASHBOARD) });
  const deleteSection = editing.ownedListing && (
    <section
      aria-label="Delete this listing"
      className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-destructive/40 p-6"
      data-testid="edit-listing-delete"
    >
      <div className="min-w-0 flex-1">
        <Heading level={2} size="md">
          Delete this listing
        </Heading>
        <Typography as="p" className="mt-1 text-sm text-muted-foreground">
          Removes it from your homeserver for good. To stop sales but keep it, unlist it from the listing page instead.
        </Typography>
      </div>
      <Button
        variant="secondary"
        className="rounded-full text-destructive"
        disabled={isSaving}
        onClick={() => {
          const record = editing.ownedListing;
          if (!record) return;
          void deleting.request([
            { ownerPubky: record.ownerPubky, listingId: record.listingId, title: record.title, record },
          ]);
        }}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Delete listing
      </Button>
      <MarketplaceListingDeleteDialog controller={deleting} />
    </section>
  );

  const persistListing = async (options?: { silent?: boolean }) => {
    if (deleting.open) return false;
    setIsSaving(true);
    try {
      const savedId = await editing.submit(options);
      return Boolean(savedId);
    } finally {
      setIsSaving(false);
    }
  };

  const submit = persistListing;

  if (editing.status !== 'ready') {
    return (
      <MarketplaceContentLayout>
        <Container overrideDefaults className="w-full">
          {editing.status === 'loading' ? (
            <MarketplaceSkeleton count={1} />
          ) : (
            <Container className="min-h-96 items-center justify-center px-6 text-center">
              <Store className="mb-4 size-12 text-muted-foreground" />
              <Heading level={1} size="lg">
                {editing.status === 'not-owner'
                  ? 'Only the seller can edit this listing'
                  : editing.status === 'unsupported'
                    ? 'This listing cannot be edited here'
                    : 'Listing unavailable'}
              </Heading>
              <Typography as="p" className="mt-2 max-w-md text-muted-foreground">
                {editing.status === 'not-owner'
                  ? 'This listing was published with a different pubky.'
                  : editing.status === 'unsupported'
                    ? 'This listing uses digital delivery settings or a pricing asset the in-app studio cannot author, so editing it here could break its payment-locked content or silently rewrite its price.'
                    : 'This listing could not be loaded from your device or the network.'}
              </Typography>
              <Button asChild className="mt-6 rounded-full">
                <Link href={listingRoute} overrideDefaults>
                  Back to listing
                </Link>
              </Button>
              {editing.status === 'unsupported' && deleteSection && (
                <div className="mt-8 w-full max-w-xl text-left">{deleteSection}</div>
              )}
            </Container>
          )}
        </Container>
      </MarketplaceContentLayout>
    );
  }

  return (
    <MarketplaceContentLayout disableMainContentOverflow className="pb-28 lg:pb-16">
      <Container overrideDefaults className="flex w-full flex-col gap-6">
        <Link
          href={listingRoute}
          overrideDefaults
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to listing
        </Link>

        <div>
          <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
            Edit listing
          </Heading>
          <Typography as="p" className="mt-3 flex max-w-2xl items-center gap-2 text-muted-foreground">
            <PencilLine className="size-4 shrink-0 text-brand" />
            Saving publishes a new owner-signed revision of the same listing. Photos already uploaded are reused, not
            re-uploaded.
          </Typography>
        </div>

        {editing.publishBlocked && (
          <ListingPublishGuardNotice
            reason={editing.publishBlocked}
            surface="seller-publish-blocked"
            density="banner"
            returnTo={getMarketplaceListingEditRoute(sellerPubky, listingId)}
          />
        )}

        <MarketplaceListingForm
          form={editing.form}
          media={editing.media}
          onSubmit={submit}
          onPublished={() => router.push(listingRoute)}
          isPublishing={isSaving}
          listingId={listingId}
          mode="edit"
          saleTermsLocked={editing.saleTermsLocked}
          storeSync={
            storeSync.sync
              ? {
                  sync: storeSync.sync,
                  savingGroup: storeSync.savingGroup,
                  onToggle: (group) => void storeSync.toggleOverride(group),
                }
              : null
          }
          publishBlocked={editing.publishBlocked}
          publishGuardReady={editing.publishGuardReady}
          returnTo={getMarketplaceListingEditRoute(sellerPubky, listingId)}
        />
        <Button asChild variant="ghost" className="rounded-full">
          <Link href={listingRoute} overrideDefaults>
            Cancel and go back
          </Link>
        </Button>
        {deleteSection}
      </Container>
    </MarketplaceContentLayout>
  );
}
