'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HandCoins } from 'lucide-react';
import { getMarketplaceListingRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { CommerceController } from '@/controllers/commerce/commerce';
import { isMarketplaceAwardCheckoutEligible } from '@/core/services/marketplace/marketplace-projections';
import { useMarketplaceCart } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { useMarketplaceFirstMediaUrl } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { useMarketplaceOffers } from '@/hooks/useMarketplaceOffers/useMarketplaceOffers';
import { getMarketplaceOfferCheckoutRoute } from '@/libs/commerce/checkout-phase';
import { formatCommerceMoney } from '@/libs/commerce/format';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { AMOUNT_EXAMPLES, amountInputExample, amountInputUnitLabel } from '@/libs/commerce/pricing';
import { formatDateTime } from '@/libs/utils/dateTime';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { ControlledTextareaField } from '@/molecules/ControlledTextareaField/ControlledTextareaField';
import { MarketplaceEmptyState } from '@/molecules/Marketplace/MarketplaceEmptyState';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import type { MarketplaceOffer, MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';

export function MarketplaceOffers() {
  const router = useRouter();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const offers = useMarketplaceOffers();
  const cart = useMarketplaceCart();
  const [convertedOrderStates, setConvertedOrderStates] = useState<Record<string, MarketplaceOrder['state']>>({});
  const [countering, setCountering] = useState<MarketplaceOffer | null>(null);
  const { listings, isHydrating } = useOfferListings(offers.offers);
  const linkedOfferId = useOfferAnchor();
  const linkedOfferMissing = isLinkedOfferMissing(linkedOfferId, offers.offers, offers.isLoading, offers.error);

  useEffect(() => {
    let active = true;
    const orderIds = offers.offers
      .map(({ award }) => award?.convertedOrderId)
      .filter((orderId): orderId is string => Boolean(orderId));
    if (!orderIds.length) {
      setConvertedOrderStates({});
      return () => {
        active = false;
      };
    }
    void Promise.all(
      [...new Set(orderIds)].map(async (orderId) => {
        try {
          const order = await CommerceController.getMarketplaceOrder(orderId);
          return order ? ([orderId, order.state] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((states) => {
      if (!active) return;
      setConvertedOrderStates(
        Object.fromEntries(
          states.filter((state): state is readonly [string, MarketplaceOrder['state']] => state !== null),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [offers.offers]);

  const submitCounter = async () => {
    if (!countering || !(await offers.counter(countering))) return;
    setCountering(null);
  };

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-28"
    >
      <Container overrideDefaults className="flex w-full flex-col gap-6">
        <MarketplaceSectionNav />
        <div>
          <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
            Offers
          </Heading>
          <Typography as="p" className="mt-2 text-muted-foreground">
            Manage offers you’ve sent and received.
          </Typography>
        </div>

        {offers.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : offers.needsSession && offers.error ? (
          <MarketplaceEmptyState
            icon={HandCoins}
            title="No offers yet"
            description="Offers you send and receive will appear here."
          />
        ) : offers.error ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-4">
            {offers.error}
          </div>
        ) : linkedOfferMissing ? (
          <Typography as="p" role="status" className="rounded-md p-4 text-muted-foreground">
            This offer is no longer available.
          </Typography>
        ) : offers.offers.length ? (
          <div className="grid gap-4">
            {offers.offers.map((offer) => {
              const actionable = offer.state === 'pending' || offer.state === 'countered';
              const incoming = offer.offeredBy !== currentUserPubky;
              const convertedAward = offer.award?.state === 'converted' ? offer.award : null;
              const convertedOrderState = convertedAward?.convertedOrderId
                ? convertedOrderStates[convertedAward.convertedOrderId]
                : undefined;
              return (
                <Card key={offer.id} id={`offer-${offer.id}`} className="rounded-md p-0">
                  <CardContent className="grid min-w-0 gap-4 p-6">
                    <div>
                      <OfferListingSummary
                        offer={offer}
                        listing={listings.get(listingCompositeId(offer))}
                        isHydrating={isHydrating}
                      />
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{incoming ? 'Incoming' : 'Sent'}</Badge>
                        <Badge variant="outline">{offerStateLabel(offer.state, offer.expiresAt)}</Badge>
                      </div>
                      {offerIsOpen(offer.state) && (
                        <Typography as="p" className="mt-4 text-sm text-muted-foreground">
                          Offer expires {formatDateTime(new Date(offer.expiresAt))}
                        </Typography>
                      )}
                      {offer.award && offer.state === 'accepted' && offer.buyerPubky === currentUserPubky && (
                        <Typography as="p" className="mt-2 text-sm text-brand">
                          Accepted offer · {formatCommerceMoney(offer.award.unitPrice)} each · Quantity{' '}
                          {offer.award.quantity} · Buy by {formatDateTime(new Date(offer.award.convertBy))}
                        </Typography>
                      )}
                      {offer.state === 'accepted' &&
                        offer.buyerPubky === currentUserPubky &&
                        (!offer.award ||
                          offer.award.state !== 'active' ||
                          !isMarketplaceAwardCheckoutEligible(offer.award)) && (
                          <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                            Checkout for this offer is unavailable.
                          </Typography>
                        )}
                      {offer.state === 'accepted' &&
                        offer.sellerPubky === currentUserPubky &&
                        offer.award?.state === 'active' &&
                        offer.award.convertBy && (
                          <Typography as="p" className="text-sm text-muted-foreground">
                            Buyer checkout window closes {formatDateTime(new Date(offer.award.convertBy))}
                          </Typography>
                        )}
                      {convertedAward && (
                        <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                          Converted to an order
                          {convertedAward.convertedOrderId && (
                            <>
                              {' · '}
                              <Link
                                href={`${MARKETPLACE_ROUTES.ORDERS}#${convertedAward.convertedOrderId}`}
                                overrideDefaults
                                className="underline"
                              >
                                View order
                              </Link>
                            </>
                          )}
                        </Typography>
                      )}
                      {convertedAward &&
                        convertedOrderState === 'cancelled' &&
                        convertedAward.listing.sellerPubky !== currentUserPubky && (
                          <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                            <Link
                              href={getMarketplaceListingRoute(
                                convertedAward.listing.sellerPubky,
                                convertedAward.listing.listingId,
                              )}
                              overrideDefaults
                              className="underline"
                            >
                              Make a new offer to buy this item
                            </Link>
                          </Typography>
                        )}
                      {offer.message && (
                        <Typography as="p" className="mt-2 text-sm">
                          “{offer.message}”
                        </Typography>
                      )}
                    </div>
                    {offer.award &&
                    offer.award.state === 'active' &&
                    isMarketplaceAwardCheckoutEligible(offer.award) &&
                    offer.state === 'accepted' &&
                    offer.buyerPubky === currentUserPubky ? (
                      <div className="flex flex-col items-start gap-2">
                        <Button
                          size="default"
                          className="rounded-full"
                          onClick={async () => {
                            const award = offer.award;
                            if (!award || award.state !== 'active') return;
                            const added = await cart.addAward(
                              `${award.listing.sellerPubky}:${award.listing.listingId}`,
                              award.variant.id,
                              award.quantity,
                              award.id,
                              offer.revision,
                            );
                            if (added) router.push(getMarketplaceOfferCheckoutRoute(offer.id));
                          }}
                        >
                          Buy for {formatCommerceMoney(offer.award.subtotal)} + shipping
                        </Button>
                        <Typography as="p" className="text-xs text-muted-foreground">
                          Priced from your accepted offer
                        </Typography>
                      </div>
                    ) : actionable ? (
                      <div className="flex flex-wrap gap-2">
                        {incoming ? (
                          <>
                            <Button
                              size="default"
                              className="rounded-full"
                              onClick={() => void offers.act(offer, 'offer.accept')}
                            >
                              Accept
                            </Button>
                            <Button
                              size="default"
                              variant="outline"
                              className="rounded-full"
                              onClick={() => setCountering(offer)}
                            >
                              Counter
                            </Button>
                            <Button
                              size="default"
                              variant="ghost"
                              className="rounded-full"
                              onClick={() => void offers.act(offer, 'offer.reject')}
                            >
                              Decline
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="default"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => void offers.act(offer, 'offer.withdraw')}
                          >
                            Withdraw
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <MarketplaceEmptyState
            icon={HandCoins}
            title="No offers yet"
            description="Offers you send and receive will appear here."
          />
        )}
      </Container>

      <Dialog open={Boolean(countering)} onOpenChange={(open) => !open && setCountering(null)}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>Send a counteroffer</DialogTitle>
          </DialogHeader>
          <ControlledInputField
            name="amount"
            control={offers.form.control}
            label={`Counter amount (${countering ? amountInputUnitLabel(countering.amount) : 'USD'})`}
            placeholder={countering ? amountInputExample(countering.amount, AMOUNT_EXAMPLES.counterOffer) : '110.00'}
          />
          <ControlledInputField name="quantity" control={offers.form.control} label="Quantity" placeholder="1" />
          <ControlledTextareaField
            name="message"
            control={offers.form.control}
            label="Message"
            placeholder="Explain your terms"
          />
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setCountering(null)}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submitCounter}>
              Send counter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ContentLayout>
  );
}

/** Open offers still have an expiry. Every other state is finished. */
export function offerIsOpen(state: MarketplaceOffer['state']): boolean {
  return state === 'pending' || state === 'countered';
}

export function offerStateLabel(state: MarketplaceOffer['state'], expiresAt: string, nowMs = Date.now()): string {
  if (state === 'rejected') return 'Declined';
  if (state === 'accepted' && Date.parse(expiresAt) <= nowMs) return 'Expired';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

const LISTING_HYDRATION_CONCURRENCY = 4;

export async function loadOfferListings(offers: readonly MarketplaceOffer[]) {
  const ids = [...new Set(offers.map(listingCompositeId).filter(Boolean))];
  if (!ids.length) return new Map<string, CommerceListingRecord>();

  const localModels = await CommerceController.getManyListings(ids);
  const local = new Map([...localModels].map(([id, model]) => [id, model.record] as [string, CommerceListingRecord]));
  const missing = ids.filter((id) => !local.has(id));
  if (!missing.length) return local;

  const hydrated = new Map<string, CommerceListingRecord>();
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const compositeId = missing[next++];
      const separator = compositeId.indexOf(':');
      try {
        const record = await CommerceController.getOrFetchListing(
          compositeId.slice(0, separator),
          compositeId.slice(separator + 1),
        );
        hydrated.set(compositeId, record);
      } catch {
        // Missing listings are rendered as unavailable after bounded hydration.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LISTING_HYDRATION_CONCURRENCY, missing.length) }, () => worker()));
  return new Map([...local, ...hydrated]);
}

function listingCompositeId(offer: MarketplaceOffer): string {
  const listingRef = parseListingAggregateId(offer.listingAggregateId);
  return listingRef ? `${listingRef.sellerPubky}:${listingRef.listingId}` : '';
}

function useOfferListings(offers: readonly MarketplaceOffer[]) {
  const ids = useMemo(() => offers.map(listingCompositeId).filter(Boolean).sort().join('|'), [offers]);
  const [listings, setListings] = useState<Map<string, CommerceListingRecord>>(new Map());
  const [isHydrating, setIsHydrating] = useState(false);

  useEffect(() => {
    let active = true;
    const currentOffers = offers;
    setListings(new Map());
    setIsHydrating(false);
    void loadOfferListings(currentOffers).then((nextListings) => {
      if (!active) return;
      setListings(nextListings);
      setIsHydrating(false);
    });
    if (ids) setIsHydrating(true);
    return () => {
      active = false;
    };
  }, [ids, offers]);

  return { listings, isHydrating };
}

function useOfferAnchor() {
  const [offerId, setOfferId] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setOfferId(window.location.hash.startsWith('#offer-') ? window.location.hash.slice(7) : null);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return offerId;
}

export function isLinkedOfferMissing(
  linkedOfferId: string | null,
  offers: readonly MarketplaceOffer[],
  isLoading: boolean,
  error: string | null,
): boolean {
  return !isLoading && !error && linkedOfferId !== null && !offers.some((offer) => offer.id === linkedOfferId);
}

export function OfferListingSummary({
  offer,
  listing,
  isHydrating = false,
}: {
  offer: MarketplaceOffer;
  listing?: CommerceListingRecord;
  isHydrating?: boolean;
}) {
  const listingRef = parseListingAggregateId(offer.listingAggregateId);

  const imageUri = listing?.media.find(({ type }) => type === 'image')?.url ?? null;
  const mediaUrl = useMarketplaceFirstMediaUrl(imageUri ? [imageUri] : []);
  return (
    <MarketplaceProductSummary
      inset
      title={listing?.title ?? (isHydrating ? 'Loading listing…' : 'Listing details unavailable')}
      href={
        listingRef && listing ? getMarketplaceListingRoute(listingRef.sellerPubky, listingRef.listingId) : undefined
      }
      imageUrl={mediaUrl}
      titleDetails={offer.award?.variant.options.map(({ value }) => value).filter(Boolean)}
      quantity={offer.quantity}
      price={
        <>
          {formatCommerceMoney(offer.amount)}
          <MarketplaceIndicativePrice money={offer.amount} className="font-normal" />
        </>
      }
    />
  );
}

export function parseListingAggregateId(value: string): { sellerPubky: string; listingId: string } | null {
  const encoded = value.startsWith('listing:') ? value.slice('listing:'.length) : '';
  if (encoded.length <= 53) return null;
  const sellerPubky = encoded.slice(0, 52);
  const listingId = encoded.slice(53);
  return sellerPubky && listingId ? { sellerPubky, listingId } : null;
}
