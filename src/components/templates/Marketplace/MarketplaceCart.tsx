'use client';

import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { getMarketplaceListingRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useMarketplaceCart } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { useMarketplaceFirstMediaUrls } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { useMarketplaceOffers } from '@/hooks/useMarketplaceOffers/useMarketplaceOffers';
import { getMarketplaceCheckoutRoute, getMarketplaceOfferCheckoutRoute } from '@/libs/commerce/checkout-phase';
import { DIGITAL_CHECKOUT_COPY } from '@/libs/commerce/digital';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { commerceListingFulfillmentMethods } from '@/libs/commerce/marketplace-records';
import { formatDateTime } from '@/libs/utils/dateTime';
import { MarketplaceCheckoutSteps } from '@/molecules/Marketplace/MarketplaceCheckoutSteps';
import { MarketplaceEmptyState } from '@/molecules/Marketplace/MarketplaceEmptyState';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { MarketplaceSellerLink } from '@/molecules/Marketplace/MarketplaceSellerLink';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceCartSkeleton } from './MarketplaceCart.skeleton';

export function MarketplaceCart() {
  const cart = useMarketplaceCart();
  const cartMediaUris = cart.items.map((item) =>
    item.listing.record.media.filter(({ type }) => type === 'image').map(({ url }) => url),
  );
  const cartMediaUrls = useMarketplaceFirstMediaUrls(cartMediaUris);
  const ordinaryItems = cart.ordinaryItems ?? cart.items;
  const digitalOnlyCount = ordinaryItems.filter((item) => {
    const methods = commerceListingFulfillmentMethods(item.listing.record.fulfillmentMethods);
    return methods.length === 1 && methods[0] === 'digital';
  }).length;
  const allDigital = ordinaryItems.length > 0 && digitalOnlyCount === ordinaryItems.length;
  const awardItems = cart.awardItems ?? [];
  const offers = useMarketplaceOffers();

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
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
              Cart
            </Heading>
            <Typography as="p" className="mt-2 text-muted-foreground">
              {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} in your cart.
            </Typography>
          </div>
          <div className="w-full justify-self-end md:w-auto">
            <MarketplaceCheckoutSteps currentStep={1} />
          </div>
        </div>

        {cart.isLoading ? (
          <div data-surface="marketplace-cart">
            <MarketplaceCartSkeleton />
          </div>
        ) : cart.items.length ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]" data-surface="marketplace-cart">
            <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1">
              <div className="flex flex-col gap-3" data-testid="marketplace-cart-items">
                {awardItems.map((item) => {
                  const variant = item.listing.record.variants.find(({ id }) => id === item.variantId);
                  const award = offers.offers.find(({ award }) => award?.id === item.awardId)?.award;
                  return (
                    <section
                      key={item.id}
                      className="grid gap-3"
                      aria-label="Accepted offer checkout"
                      data-surface="marketplace-award-cart-group"
                    >
                      <Heading level={2} size="sm" className="text-xl font-semibold">
                        Accepted offer
                      </Heading>
                      <Card className="rounded-md p-0">
                        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <MarketplaceProductSummary
                              title={item.listing.record.title}
                              href={getMarketplaceListingRoute(item.listing.record.ownerPubky, item.listing.listing_id)}
                              imageUrl={cartMediaUrls[cart.items.findIndex(({ id }) => id === item.id)] ?? null}
                              quantity={item.quantity}
                              details={<MarketplaceSellerLink sellerPubky={item.listing.record.ownerPubky} />}
                              titleDetails={variant ? Object.values(variant.options).filter(Boolean) : undefined}
                              price={
                                award && (
                                  <>
                                    {formatCommerceMoney(award.unitPrice)}
                                    <MarketplaceIndicativePrice money={award.unitPrice} className="font-normal" />
                                  </>
                                )
                              }
                            />
                            {award && (
                              <>
                                <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                                  {formatCommerceMoney(award.unitPrice)} × {award.quantity} +{' '}
                                  {formatCommerceMoney(award.shipping)} shipping ={' '}
                                  {formatCommerceMoney(award.merchandiseTotal)}
                                </Typography>
                                <Typography as="p" className="text-sm text-muted-foreground">
                                  Buy by {formatDateTime(new Date(award.convertBy))}
                                </Typography>
                              </>
                            )}
                            <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                              Quantity and variant are fixed at the accepted offer.
                            </Typography>
                          </div>
                          <Button asChild className="rounded-full">
                            <Link href={getMarketplaceOfferCheckoutRoute(item.awardId)} overrideDefaults>
                              Checkout
                            </Link>
                          </Button>
                          <Button
                            size="icon"
                            variant="secondary"
                            aria-label={`Remove ${item.listing.record.title}`}
                            onClick={() => void cart.remove(item.listingId, item.variantId, item.awardId ?? undefined)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    </section>
                  );
                })}
                {cart.groups.map((group) => (
                  <section
                    key={group.sellerPubky}
                    className="grid gap-3"
                    aria-label={`Cart items from ${group.sellerPubky}`}
                  >
                    {group.items.map((item) => {
                      const variant = item.listing.record.variants.find(({ id }) => id === item.variantId);
                      const price =
                        variant?.priceOverride ??
                        (item.listing.record.sale.format === 'fixed_price' ? item.listing.record.sale.unitPrice : null);
                      const coverUrl = cartMediaUrls[cart.items.findIndex(({ id }) => id === item.id)] ?? null;
                      const listingRoute = getMarketplaceListingRoute(
                        item.listing.record.ownerPubky,
                        item.listing.listing_id,
                      );
                      return (
                        <Card key={item.id} className="rounded-md p-0">
                          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
                            <MarketplaceProductSummary
                              className="flex-1"
                              title={item.listing.record.title}
                              href={listingRoute}
                              imageUrl={coverUrl}
                              details={<MarketplaceSellerLink sellerPubky={group.sellerPubky} />}
                              titleDetails={variant ? Object.values(variant.options).filter(Boolean) : undefined}
                              price={
                                price && (
                                  <>
                                    {formatCommerceMoney(price)}{' '}
                                    <MarketplaceIndicativePrice money={price} className="font-normal" />
                                  </>
                                )
                              }
                            />
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 sm:flex sm:shrink-0">
                              {((variant?.quantity ?? 0) > 1 || item.quantity > 1) && (
                                <div className="col-start-2 flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Decrease ${item.listing.record.title} quantity`}
                                    disabled={item.quantity <= 1}
                                    onClick={() => void cart.update(item.listingId, item.variantId, item.quantity - 1)}
                                  >
                                    <Minus className="size-4" />
                                  </Button>
                                  <Typography as="span" className="min-w-8 text-center">
                                    {item.quantity}
                                  </Typography>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Increase ${item.listing.record.title} quantity`}
                                    disabled={!variant || item.quantity >= variant.quantity}
                                    onClick={() => void cart.update(item.listingId, item.variantId, item.quantity + 1)}
                                  >
                                    <Plus className="size-4" />
                                  </Button>
                                </div>
                              )}
                              <Button
                                className="col-start-3 justify-self-end"
                                size="icon"
                                variant="secondary"
                                aria-label={`Remove ${item.listing.record.title}`}
                                onClick={() => void cart.remove(item.listingId, item.variantId)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>

            {ordinaryItems.length > 0 && (
              <Card
                className="h-fit rounded-md p-0 shadow-lg lg:col-start-2 lg:row-start-1 lg:self-start"
                data-testid="marketplace-cart-summary"
              >
                <CardContent className="grid min-w-0 gap-6 p-6">
                  <section className="grid min-w-0 gap-6" aria-label="Total">
                    <Heading level={2} size="sm" className="text-xl font-semibold">
                      Total
                    </Heading>
                    <SettingsSectionContent>
                      <div className="grid gap-6">
                        <div className="flex justify-between">
                          <Typography as="span">Items</Typography>
                          <div className="flex flex-col items-end">
                            {cart.subtotals.map((subtotal) => (
                              <Typography
                                key={`${subtotal.currency}:${subtotal.exponent}`}
                                as="span"
                                className="flex flex-col items-end font-bold"
                              >
                                {formatCommerceMoney(subtotal)}
                                <MarketplaceIndicativePrice money={subtotal} className="font-normal" />
                              </Typography>
                            ))}
                          </div>
                        </div>
                        <hr className="m-0 border-border" />
                        <div className="grid gap-1">
                          <Typography as="p" className="text-foreground">
                            {allDigital ? 'Delivery' : 'Shipping'}
                          </Typography>
                          <Typography as="p" className="text-xs text-muted-foreground">
                            {allDigital
                              ? DIGITAL_CHECKOUT_COPY.noShippingDigital
                              : digitalOnlyCount > 0
                                ? DIGITAL_CHECKOUT_COPY.shippingMixedWithDigital
                                : 'Shipping is calculated at checkout.'}
                          </Typography>
                        </div>
                      </div>
                      <Button asChild className="w-full rounded-full">
                        <Link
                          href={getMarketplaceCheckoutRoute()}
                          overrideDefaults
                          data-testid="marketplace-cart-checkout"
                        >
                          Checkout
                        </Link>
                      </Button>
                    </SettingsSectionContent>
                  </section>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <MarketplaceEmptyState
            icon={ShoppingCart}
            title="Your cart is empty"
            description="Items you add from listings appear here, saved on this device."
            surface="marketplace-cart"
          />
        )}
      </Container>
    </ContentLayout>
  );
}
