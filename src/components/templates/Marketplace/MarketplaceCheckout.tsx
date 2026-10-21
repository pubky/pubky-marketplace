'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HandCoins, LoaderCircle, ShoppingCart, WalletCards } from 'lucide-react';
import { Controller, useWatch } from 'react-hook-form';
import { APP_ROUTES, getMarketplaceDropRoute, getMarketplaceListingRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Image } from '@/atoms/Image/Image';
import { Label } from '@/atoms/Label/Label';
import { Link } from '@/atoms/Link/Link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { withBasePath } from '@/config/base-path';
import {
  getCommerceAdapterMode,
  getPaykitServerApi,
  isDurableCommerceMode,
  isLocksPaykitCommerceMode,
} from '@/config/commerce';
import { MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { isMarketplaceAwardCheckoutEligible } from '@/core/services/marketplace/marketplace-projections';
import { useBuyerPaykitWallet } from '@/hooks/useBuyerPaykitWallet/useBuyerPaykitWallet';
import { useCheckoutRegion } from '@/hooks/useCheckoutRegion/useCheckoutRegion';
import {
  groupMarketplaceCartItems,
  type MarketplaceCartItem,
  marketplaceCartShippingTotals,
  useMarketplaceCart,
} from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { useMarketplaceCartStock } from '@/hooks/useMarketplaceCartStock/useMarketplaceCartStock';
import { useMarketplaceCheckout } from '@/hooks/useMarketplaceCheckout/useMarketplaceCheckout';
import { marketplaceCheckoutSchema } from '@/hooks/useMarketplaceCheckout/useMarketplaceCheckout.types';
import { useMarketplaceFirstMediaUrls } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { useMarketplaceOfferCheckout } from '@/hooks/useMarketplaceOfferCheckout/useMarketplaceOfferCheckout';
import { useMarketplaceOffers } from '@/hooks/useMarketplaceOffers/useMarketplaceOffers';
import { useMarketplaceOrders } from '@/hooks/useMarketplaceOrders/useMarketplaceOrders';
import { useMarketplaceSellerDeliveryTerms } from '@/hooks/useMarketplaceSellerDeliveryTerms/useMarketplaceSellerDeliveryTerms';
import { usePaykitOutage } from '@/hooks/usePaykitOutage/usePaykitOutage';
import { useUsdtPaymentsCapability } from '@/hooks/useUsdtPaymentsCapability/useUsdtPaymentsCapability';
import { buyerCheckoutProgressCopy } from '@/libs/commerce/bitcoin-buyer-status';
import { bitcoinPaymentCodeCheckoutNote } from '@/libs/commerce/bitcoin-payment-code';
import { cartLineStockLabel, SOLD_OUT_COPY } from '@/libs/commerce/cart-stock';
import {
  getMarketplaceCheckoutRoute,
  intersectPaymentMethods,
  isPendingPaymentState,
  readCheckoutOrderId,
} from '@/libs/commerce/checkout-phase';
import { DELIVERY_EMAIL_MAX_CHARS, DIGITAL_CHECKOUT_COPY, digitalCheckoutLineLabel } from '@/libs/commerce/digital';
import { marketplaceOfferCheckoutFailureMessage } from '@/libs/commerce/failure-messages';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { tracksVariantStock } from '@/libs/commerce/listing-variants';
import { LOCKS_MIXED_CHECKOUT_COPY, locksCheckoutRoute } from '@/libs/commerce/locks-payment';
import { commerceVariantUnitPrice } from '@/libs/commerce/marketplace-records';
import { PAYKIT_OUTAGE_COPY } from '@/libs/commerce/paykit-rail';
import {
  CHECKOUT_SUBMIT_LABEL,
  observedPaymentRail,
  orderMayPayInUsdt,
  paykitCheckoutCancellable,
  paykitPickerLabel,
  paykitRequirementCopy,
  sharedPaykitAssets,
  STAGING_USDT_FUNDS_NOTE,
  unboundOrderMayPayInUsdt,
} from '@/libs/commerce/paykit-rail';
import {
  BITCOIN_WALLET_FORK_REQUIRED_COPY,
  BITCOIN_WALLET_FORK_REQUIRED_TITLE,
  BITCOIN_WALLET_UNSUPPORTED_TITLE,
  BITCOIN_WALLET_UNVERIFIED_TITLE,
  bitcoinWalletUnsupportedBody,
  bitcoinWalletUnsupportedPayReason,
  bitcoinWalletUnverifiedBody,
  bitcoinWalletUnverifiedPayReason,
} from '@/libs/commerce/paykit-wallet';
import { availablePaymentMethods, type PaymentMethodKind, sellerPaykitAssets } from '@/libs/commerce/payment-methods';
import { formatUsdt, type PaymentAsset } from '@/libs/commerce/payment-options';
import {
  PAYKIT_USDT_FINALITY_EXPECTATION_COPY,
  USDT_MULTI_SELLER_COPY,
  USDT_NETWORK_LABEL,
  USDT_WALLET_HINT,
  usdtFulfilmentWaitsForFinality,
  usdtParityMillionths,
} from '@/libs/commerce/usdt-buyer-status';
import { usdtMissingOptionExplanation } from '@/libs/commerce/usdt-missing-option';
import { navigateTop } from '@/libs/navigation/navigate-top';
import { getDeployEnv } from '@/libs/runtime-config/runtime-config';
import { formatDateTime } from '@/libs/utils/dateTime';
import type { CommerceListingModelSchema } from '@/models/commerce/commerce.schema';
import { BitkitDownloads } from '@/molecules/BitkitDownloads/BitkitDownloads';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { BuyerCountryField } from '@/molecules/Marketplace/BuyerCountryField';
import { CheckoutSaleTerms } from '@/molecules/Marketplace/CheckoutSaleTerms';
import { DeliveryKeyBlockedNotice } from '@/molecules/Marketplace/DeliveryKeyBlockedNotice';
import { MarketplaceCheckoutStatusLabels } from '@/molecules/Marketplace/MarketplaceCheckoutStatusLabels';
import { MarketplaceCheckoutSteps } from '@/molecules/Marketplace/MarketplaceCheckoutSteps';
import { MarketplaceSellerLink } from '@/molecules/Marketplace/MarketplaceSellerLink';
import { PaykitOutageNotice } from '@/molecules/Marketplace/PaykitOutageNotice';
import { MarketplaceAddressFields } from '@/molecules/MarketplaceAddressFields/MarketplaceAddressFields';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceBuyerBitkitConnectDialog } from '@/organisms/Marketplace/MarketplaceBuyerBitkitConnectDialog';
import { MarketplaceCheckoutItem } from '@/organisms/Marketplace/MarketplaceCheckoutItem';
import { MarketplaceCheckoutStoreShare } from '@/organisms/Marketplace/MarketplaceCheckoutStoreShare';
import { MarketplaceDeliveryKeyChangeDialog } from '@/organisms/Marketplace/MarketplaceDeliveryKeyChangeDialog';
import { MarketplaceDeliveryTerms } from '@/organisms/Marketplace/MarketplaceDeliveryTerms';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import { MarketplaceOrderActions } from '@/organisms/Marketplace/MarketplaceOrderActions';
import { MarketplaceOrderReference } from '@/organisms/Marketplace/MarketplaceOrderReference';
import { MarketplacePaymentStatusCard } from '@/organisms/Marketplace/MarketplacePaymentStatusCard';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceSessionRequiredCard } from '@/organisms/Marketplace/MarketplaceSessionRequiredCard';
import { MarketplaceUsdtMissingNote } from '@/organisms/Marketplace/MarketplaceUsdtMissingNote';
import type { MarketplaceOfferAward } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { MarketplaceCartSkeleton } from './MarketplaceCart.skeleton';

type AwardPayOutcome = 'expired' | 'converted' | 'error' | 'success' | 'unavailable' | 'session';

const EMPTY_CHECKOUT_ITEMS: MarketplaceCartItem[] = [];

const CHECKOUT_RAILS = ['paykit', 'paypal'] as const;
type CheckoutRail = (typeof CHECKOUT_RAILS)[number];

// The sandbox simulates payments and can bind no real rail, so it only ever says Bitcoin.
const SANDBOX_CHECKOUT_RAILS = ['paykit', 'paypal'] as const;
const BITCOIN_ONLY_ASSETS: PaymentAsset[] = ['BTC'];

function MethodLabel({ method, paykitAssets }: { method: CheckoutRail; paykitAssets: readonly PaymentAsset[] }) {
  if (method === 'paypal') return 'PayPal';
  const label = paykitPickerLabel(paykitAssets);
  return (
    <span className="grid min-w-0 text-left leading-tight">
      <span>{label.assets}</span> <span className="text-sm font-normal opacity-80">{label.wallet}</span>
    </span>
  );
}

function checkoutRails(methods: readonly PaymentMethodKind[]): CheckoutRail[] {
  return CHECKOUT_RAILS.filter((method) => methods.includes(method));
}

export function MarketplaceCheckout() {
  return <MarketplaceCartCheckout />;
}

function MarketplaceCartCheckout() {
  const searchParams = useSearchParams();
  const offerReference = searchParams.get('offer');
  const dropSeller = searchParams.get('seller');
  const dropId = searchParams.get('drop');
  const dropListingId = searchParams.get('listing');
  const dropVariantId = searchParams.get('variant');
  const resumeOrderId = readCheckoutOrderId(searchParams);
  const isOfferCheckout = Boolean(offerReference);
  const isDropCheckout = Boolean(dropSeller && dropId && dropListingId);

  const cart = useMarketplaceCart();
  const offers = useMarketplaceOffers();
  const offerPay = useMarketplaceOfferCheckout();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [dropItem, setDropItem] = useState<MarketplaceCartItem | null>(null);
  const [dropLoadState, setDropLoadState] = useState<'idle' | 'loading' | 'ready' | 'missing'>(() =>
    dropSeller && dropListingId ? 'loading' : 'idle',
  );
  const [awardOutcome, setAwardOutcome] = useState<AwardPayOutcome | null>(null);
  const [awardErrorCode, setAwardErrorCode] = useState<string | null>(null);

  const offer = offers.offers.find((item) => item.id === offerReference || item.award?.id === offerReference);
  const award: MarketplaceOfferAward | undefined = offer?.award;
  const offerEligible = Boolean(
    offer &&
    award &&
    award.state === 'active' &&
    offer.buyerPubky === currentUserPubky &&
    isMarketplaceAwardCheckoutEligible(award),
  );

  useEffect(() => {
    if (!dropSeller || !dropListingId) {
      setDropItem(null);
      setDropLoadState('idle');
      return;
    }
    let active = true;
    setDropLoadState('loading');
    void (async () => {
      try {
        try {
          await CommerceController.getOrFetchListing(dropSeller, dropListingId);
        } catch {
          // Local Dexie may still have the listing after a homeserver miss.
        }
        const listing = await CommerceController.getListing(dropSeller, dropListingId);
        if (!active) return;
        // A listing sold by size is claimed in the size the buyer chose on the drop page; none is picked here.
        const variant = !listing
          ? undefined
          : dropVariantId
            ? listing.record.variants.find((candidate) => candidate.id === dropVariantId && candidate.enabled !== false)
            : tracksVariantStock(listing.record.variants)
              ? undefined
              : (listing.record.variants.find((candidate) => candidate.enabled !== false) ??
                listing.record.variants[0]);
        if (!listing || !variant) {
          setDropItem(null);
          setDropLoadState('missing');
          return;
        }
        setDropItem(dropCheckoutItem(listing, variant.id));
        setDropLoadState('ready');
      } catch {
        if (!active) return;
        setDropItem(null);
        setDropLoadState('missing');
      }
    })();
    return () => {
      active = false;
    };
  }, [dropSeller, dropListingId, dropVariantId]);

  // An accepted offer settles only through the methods its accepted snapshot
  // published (the service authorizes award checkout from the same
  // snapshot), never from the listing as it is now.
  const awardSeller = offerEligible && award ? award.listing.sellerPubky : null;
  const awardFulfillmentMethods = award?.fulfillmentMethods;
  const awardFulfillment =
    awardSeller && awardFulfillmentMethods
      ? { sellerPubky: awardSeller, fulfillmentMethods: awardFulfillmentMethods }
      : null;

  const ordinaryItems = cart.ordinaryItems ?? cart.items;
  const checkoutItems = useMemo(() => {
    if (isOfferCheckout) return EMPTY_CHECKOUT_ITEMS;
    if (isDropCheckout) return dropItem ? [dropItem] : EMPTY_CHECKOUT_ITEMS;
    return ordinaryItems;
  }, [dropItem, isDropCheckout, isOfferCheckout, ordinaryItems]);
  const checkout = useMarketplaceCheckout(
    checkoutItems,
    isOfferCheckout || isDropCheckout ? async () => undefined : cart.clear,
    awardFulfillment,
  );
  const stock = useMarketplaceCartStock(isOfferCheckout || isDropCheckout ? EMPTY_CHECKOUT_ITEMS : checkoutItems);
  const [payRefusal, setPayRefusal] = useState<string | null>(null);
  const orders = useMarketplaceOrders();
  const adapterMode = getCommerceAdapterMode();
  const isSandbox = adapterMode === 'sandbox';
  // The picker names its assets from the seller configs read with the USDT answer, so it waits for that answer.
  const usdtCapability = useUsdtPaymentsCapability(!isSandbox).status;
  const usdtPaymentsAvailable = usdtCapability === 'available';
  const usdtCapabilityChecking = !isSandbox && usdtCapability === 'checking';
  const isStaging = getDeployEnv() === 'staging';
  const isProduction = getDeployEnv() === 'production';
  const supportsBuyerConnectionGuide = getPaykitServerApi() === 'upstream';
  const formValues = useWatch({ control: checkout.form.control });
  const formValid = marketplaceCheckoutSchema.safeParse(formValues).success;
  const displayGroups = useMemo(() => groupMarketplaceCartItems(checkoutItems), [checkoutItems]);
  const checkoutMediaUrls = useMarketplaceFirstMediaUrls(
    checkoutItems.map((item) => item.listing.record.media.filter(({ type }) => type === 'image').map(({ url }) => url)),
  );
  // The award renders as its own fulfillment section (no cart line cards).
  const fulfillmentGroups = awardSeller ? [{ sellerPubky: awardSeller, items: [], subtotals: [] }] : displayGroups;
  const sellerDeliveryTerms = useMarketplaceSellerDeliveryTerms(fulfillmentGroups.map((group) => group.sellerPubky));
  const shipping = marketplaceCartShippingTotals(displayGroups, (item) => checkout.fulfillmentForItem(item.id));
  // A pickup award pays the accepted merchandise only; its shipping is zero.
  const isPickupAward = Boolean(awardSeller && checkout.fulfillmentForSeller(awardSeller) === 'pickup');
  const lineMethods = [
    ...checkoutItems.map((item) => checkout.fulfillmentForItem(item.id)),
    ...(awardSeller ? [checkout.fulfillmentForSeller(awardSeller)] : []),
  ];
  const allPickup = lineMethods.length > 0 && lineMethods.every((method) => method === 'pickup');
  const allDigital = lineMethods.length > 0 && lineMethods.every((method) => method === 'digital');
  const itemSubtotals =
    isOfferCheckout && award
      ? [award.subtotal]
      : isDropCheckout
        ? displayGroups.flatMap((group) => group.subtotals)
        : cart.subtotals;
  const shippingTotals =
    isOfferCheckout && award
      ? [isPickupAward ? { ...award.shipping, amountMinor: 0 } : award.shipping]
      : shipping.totals;
  const totalSubtotals =
    isOfferCheckout && award
      ? [isPickupAward ? award.subtotal : award.merchandiseTotal]
      : [...itemSubtotals, ...shipping.totals].reduce<
          Array<{ amountMinor: number; currency: string; exponent: number }>
        >((totals, money) => {
          const existing = totals.find(
            (candidate) => candidate.currency === money.currency && candidate.exponent === money.exponent,
          );
          if (existing) existing.amountMinor += money.amountMinor;
          else totals.push({ ...money });
          return totals;
        }, []);
  const sessionExpired = Boolean(checkout.needsSession && checkout.sessionError);
  const approvalNeeded = isDurableCommerceMode(adapterMode) && (!checkout.hasMarketplaceSession || sessionExpired);
  const [payingOrderIds, setPayingOrderIds] = useState<string[]>([]);
  const [preferredMethod, setSelectedMethod] = useState<CheckoutRail | null>(null);
  const [buyerConnection, setBuyerConnection] = useState<{ owner: string; open: boolean } | null>(null);
  const [loadedMethods, setLoadedMethods] = useState<{
    sellerKey: string;
    attempt: number;
    methods: PaymentMethodKind[] | null;
    sharedAssets: PaymentAsset[];
    sellerAcceptsUsdt: Map<string, boolean> | null;
    paykitUnreachable: boolean;
  } | null>(null);
  const [railAttempt, setRailAttempt] = useState(0);
  // Re-reads the rails without blanking them: after a refused payment, and while Paykit is down.
  const [railRefresh, setRailRefresh] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sellerKey =
    isOfferCheckout && award
      ? award.listing.sellerPubky
      : [...new Set(checkoutItems.map((item) => item.listing.record.ownerPubky))].join('|');
  // Only a read for this cart's sellers can show an outage or keep the recheck going.
  const loadedIsCurrent = sellerKey.length > 0 && loadedMethods?.sellerKey === sellerKey;
  const {
    refused: paykitRefused,
    recheck: paykitRecheck,
    markRefused: markPaykitRefused,
    settleRead: settlePaykitRead,
  } = usePaykitOutage(
    loadedIsCurrent && (loadedMethods?.paykitUnreachable === true || loadedMethods?.methods === null),
    sellerKey.length > 0,
  );
  // Rails loaded for an earlier seller set (or before the cart hydrated) are
  // still loading for this one, never "no payment method".
  const loadedForCart =
    sellerKey.length > 0 && loadedMethods?.sellerKey === sellerKey && loadedMethods.attempt === railAttempt
      ? loadedMethods
      : null;
  // A Locks checkout on upstream Paykit pays in Bitcoin from the order page,
  // whatever rails the seller configured, and binds no method here.
  const locksRoute = isOfferCheckout ? 'method' : locksCheckoutRoute(adapterMode, getPaykitServerApi(), checkoutItems);
  const isLocksCheckout = locksRoute === 'locks';
  // A failed config read says nothing about the seller's rails; sandbox offers every rail regardless.
  const railsFailed = loadedForCart !== null && loadedForCart.methods === null && !isSandbox && !isLocksCheckout;
  const sharedMethods = isLocksCheckout
    ? (['paykit'] satisfies PaymentMethodKind[])
    : loadedForCart === null
      ? null
      : (loadedForCart.methods ?? []);
  const availableCheckoutMethods = checkoutRails(isSandbox ? SANDBOX_CHECKOUT_RAILS : (sharedMethods ?? []));
  // Paykit being down must never read as "this seller has no payment method".
  const paykitOutageForCart =
    (loadedForCart?.paykitUnreachable === true || paykitRefused) && !isSandbox && !isLocksCheckout;
  // The one Paykit entry names the assets every seller in the cart accepts; the buyer picks one in Bitkit.
  const paykitAssets =
    isSandbox || isLocksCheckout ? BITCOIN_ONLY_ASSETS : (loadedForCart?.sharedAssets ?? BITCOIN_ONLY_ASSETS);
  const paykitOffersUsdt = paykitAssets.includes('USDT');
  // Until the rails load, USDT may still be offered: only a known Bitcoin-only checkout says no real funds move.
  const stagingUsdtPossible =
    !isSandbox &&
    !isLocksCheckout &&
    (usdtCapabilityChecking || usdtPaymentsAvailable) &&
    (loadedForCart === null || paykitOffersUsdt);
  // A resumed order without a method shows its own picker; only a closed USDT gate rules USDT out there.
  const resumeOfferedAssets = usdtCapabilityChecking || usdtPaymentsAvailable ? null : BITCOIN_ONLY_ASSETS;
  const usdtMissingExplanation = usdtMissingOptionExplanation({
    gateOpen: usdtPaymentsAvailable && !isSandbox && !isLocksCheckout,
    offered: paykitOffersUsdt,
    sellerAcceptsUsdt: loadedForCart?.sellerAcceptsUsdt ?? null,
  });
  const selectedMethod =
    preferredMethod && availableCheckoutMethods.includes(preferredMethod)
      ? preferredMethod
      : (availableCheckoutMethods[0] ?? null);
  const paykitBlocksPay = (paykitRefused || paykitOutageForCart) && selectedMethod === 'paykit';
  const checkoutSellers = sellerKey === '' ? [] : sellerKey.split('|');
  const isMultiSeller = checkoutSellers.length > 1;
  const region = useCheckoutRegion({
    sellerPubkys: checkoutSellers,
    hasDigital: checkout.hasInstantDigitalLine || checkout.hasManualDigitalLine || isLocksCheckout,
    requiresDeliveryAddress: checkout.requiresDeliveryAddress,
    addressCountry: String(formValues.countryCode ?? ''),
    currentUserPubky,
  });
  const isPaying = isOfferCheckout ? offerPay.isSubmitting : checkout.isPaying;
  const listingRoute = award && getMarketplaceListingRoute(award.listing.sellerPubky, award.listing.listingId);
  const backHref =
    isDropCheckout && dropSeller && dropId ? getMarketplaceDropRoute(dropSeller, dropId) : MARKETPLACE_ROUTES.CART;
  const backLabel = isDropCheckout ? 'Back to drop' : 'Back to cart';

  useEffect(() => {
    const sellers = sellerKey.length === 0 ? [] : sellerKey.split('|');
    if (sellers.length === 0 || usdtCapabilityChecking) return;
    let active = true;
    void Promise.all(
      sellers.map(async (sellerPubky) => {
        try {
          return await CommerceController.getSellerPaymentConfig(sellerPubky);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!active) return;
      const configs = results.filter((config): config is NonNullable<typeof config> => config !== null);
      if (configs.length !== results.length) {
        // A failed read says nothing about Paykit, so the outage it may have been showing carries over.
        setLoadedMethods((previous) => ({
          sellerKey,
          attempt: railAttempt,
          methods: null,
          sharedAssets: BITCOIN_ONLY_ASSETS,
          sellerAcceptsUsdt: null,
          paykitUnreachable: previous?.sellerKey === sellerKey && previous.paykitUnreachable,
        }));
        return;
      }
      const options = { usdtPaymentsAvailable };
      const assetSets = configs.map((config) => sellerPaykitAssets(config, options));
      const paykitUnreachable = configs.some((config) => config.paykitUnreachable === true);
      setLoadedMethods({
        sellerKey,
        attempt: railAttempt,
        methods: intersectPaymentMethods(configs.map((config) => availablePaymentMethods(config, options))),
        sharedAssets: sharedPaykitAssets(assetSets),
        sellerAcceptsUsdt: new Map(
          sellers.map((sellerPubky, index) => [sellerPubky, assetSets[index].includes('USDT')]),
        ),
        paykitUnreachable,
      });
      settlePaykitRead(paykitRecheck, !paykitUnreachable);
    });
    return () => {
      active = false;
    };
  }, [
    sellerKey,
    railAttempt,
    railRefresh,
    paykitRecheck,
    usdtPaymentsAvailable,
    usdtCapabilityChecking,
    settlePaykitRead,
  ]);

  const targetPayingIds = [...new Set([...payingOrderIds, ...(resumeOrderId ? [resumeOrderId] : [])])];
  const focusedPaying = orders.orders.filter((view) => targetPayingIds.includes(view.order.id));
  const showPaying = targetPayingIds.length > 0;
  const allPaymentsConfirmed =
    targetPayingIds.length > 0 &&
    focusedPaying.length === targetPayingIds.length &&
    focusedPaying.every(({ payment }) => payment?.state === 'confirmed');
  const headerView = focusedPaying.find(({ order }) => isPendingPaymentState(order.state));
  const headerOrder = headerView?.order;
  const holdCopy = headerOrder ? buyerCheckoutProgressCopy(headerOrder, headerView.payment, nowMs) : null;

  useEffect(() => {
    if (!showPaying) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showPaying]);

  // A Paykit payment request is delivered to the buyer's Paykit wallet;
  // without one, Pay cannot succeed, so it is gated before the attempt.
  const paykitChosen = !isSandbox && selectedMethod === 'paykit';
  const paykitSelected = paykitChosen && isDurableCommerceMode(adapterMode);
  // When USDT is the only asset on offer there is no Bitcoin amount to estimate.
  const hideBitcoinEstimate = paykitChosen && !paykitAssets.includes('BTC');
  const usdtMillionths = paykitChosen && paykitOffersUsdt ? usdtParityMillionths(totalSubtotals) : null;
  const buyerConnectionRequested = paykitSelected && buyerConnection?.owner === currentUserPubky;
  const buyerConnectionOpen =
    supportsBuyerConnectionGuide && buyerConnectionRequested && Boolean(buyerConnection?.open) && !showPaying;
  const buyerWallet = useBuyerPaykitWallet(currentUserPubky ?? null, paykitSelected, buyerConnectionOpen);
  // A failed read during setup must never turn a known missing wallet into permission to pay.
  const buyerConnectionRequired = buyerConnectionRequested && buyerWallet.state !== 'payable';
  const buyerWalletMissing = paykitSelected && buyerWallet.state === 'not_payable';
  const buyerWalletUnsupported = paykitSelected && buyerWallet.state === 'unsupported';
  const buyerWalletUnverified =
    paykitSelected &&
    (buyerWallet.state === 'unverified' || (buyerConnectionRequested && buyerWallet.state === 'unknown'));
  const buyerWalletChecking = paykitSelected && buyerWallet.state === 'checking';
  const canPayWithPaypal = sharedMethods?.includes('paypal') ?? false;

  useEffect(() => {
    setBuyerConnection((connection) => {
      if (!connection || connection.owner !== currentUserPubky) return null;
      if ((!paykitSelected || showPaying) && connection.open) return { ...connection, open: false };
      return connection;
    });
  }, [paykitSelected, currentUserPubky, showPaying]);

  const checkBuyerConnection = (open: boolean) => {
    if (!currentUserPubky || !paykitSelected) return;
    setBuyerConnection({ owner: currentUserPubky, open });
    buyerWallet.recheck();
  };

  const canPay =
    !approvalNeeded &&
    !region.blocked &&
    formValid &&
    !checkout.hasFulfillmentConflict &&
    locksRoute !== 'mixed' &&
    checkout.isDigitalReady &&
    !isPaying &&
    !buyerWalletMissing &&
    !buyerWalletUnsupported &&
    !buyerWalletUnverified &&
    !buyerWalletChecking &&
    !buyerConnectionRequired &&
    (!isOfferCheckout || offerEligible) &&
    !paykitBlocksPay &&
    !stock.hasSoldOut &&
    (isSandbox || (sharedMethods !== null && sharedMethods.length > 0 && selectedMethod !== null));

  const paymentCodeNote = paykitSelected ? bitcoinPaymentCodeCheckoutNote(getPaykitServerApi()) : null;
  const checkoutPayDisabledReason = stock.hasSoldOut
    ? SOLD_OUT_COPY.payBlocked
    : approvalNeeded
      ? 'Enable purchases to pay.'
      : isPaying
        ? 'Payment is in progress.'
        : checkout.hasFulfillmentConflict
          ? "Some items can't be checked out together — see the note above."
          : !checkout.isDigitalReady
            ? checkout.digitalNotReadyItemIds.length > 0
              ? DIGITAL_CHECKOUT_COPY.payReasonNotReady
              : DIGITAL_CHECKOUT_COPY.payReasonLoading
            : buyerWalletMissing
              ? 'A compatible Bitkit wallet is required to pay with Paykit.'
              : buyerWalletUnsupported
                ? bitcoinWalletUnsupportedPayReason(canPayWithPaypal)
                : buyerWalletUnverified
                  ? bitcoinWalletUnverifiedPayReason(canPayWithPaypal)
                  : buyerWalletChecking
                    ? 'Pay unlocks once your Bitkit wallet is checked.'
                    : railsFailed
                      ? 'Pay unlocks once payment options load.'
                      : paykitBlocksPay || (paykitOutageForCart && sharedMethods?.length === 0)
                        ? PAYKIT_OUTAGE_COPY.title
                        : sharedMethods && sharedMethods.length === 0 && !isSandbox
                          ? isMultiSeller
                            ? 'Choose sellers that share a payment method.'
                            : 'Pay unlocks once this seller sets up a payment method.'
                          : buyerConnectionRequired
                            ? 'Check your Bitkit connection to pay with Paykit.'
                            : isOfferCheckout && !offerEligible
                              ? 'This offer is not available for checkout.'
                              : 'Fill in delivery details and choose a payment method to pay.';
  const payDisabledReason =
    locksRoute === 'mixed'
      ? LOCKS_MIXED_CHECKOUT_COPY
      : region.blocked
        ? (region.refusal ?? 'Tell us the country you live in to continue.')
        : checkoutPayDisabledReason;

  const removeAwardLine = async () => {
    const line = cart.awardItems.find((item) => item.awardId === award?.id);
    if (line) await cart.remove(line.listingId, line.variantId, line.awardId ?? undefined, false);
  };

  const payOffer = async () => {
    if (!offer || !award || !offerEligible) return;
    const method = isSandbox && selectedMethod === null ? null : selectedMethod;
    const values = checkout.form.getValues();
    if (!marketplaceCheckoutSchema.safeParse(values).success) return;
    const result = await offerPay.submit(
      offer,
      isPickupAward
        ? null
        : {
            name: values.name,
            line1: values.line1,
            line2: values.line2,
            city: values.city,
            region: values.region,
            postalCode: values.postalCode,
            countryCode: values.countryCode,
          },
      method,
      () => void pay(),
    );
    if (result.ok) {
      await removeAwardLine();
      await offers.refresh();
      if (!isPickupAward) await checkout.rememberAddress();
      if (result.boundOrder?.fiatCheckoutUrl) {
        navigateTop(result.boundOrder.fiatCheckoutUrl);
        return;
      }
      if (result.orderId) {
        setPayingOrderIds([result.orderId]);
        window.history.replaceState(null, '', withBasePath(getMarketplaceCheckoutRoute(result.orderId)));
        await orders.refresh();
        return;
      }
      setAwardOutcome('success');
      return;
    }
    if (result.paykitUnavailable) markPaykitRefused();
    setRailRefresh((refresh) => refresh + 1);
    if (result.code === 'AWARD_UNAVAILABLE') {
      await removeAwardLine();
      await offers.refresh();
      setAwardOutcome('unavailable');
    } else if (result.code === 'SESSION_REQUIRED') {
      setAwardOutcome('session');
    } else if (result.code === 'AWARD_EXPIRED') {
      await removeAwardLine();
      await offers.refresh();
      setAwardOutcome('expired');
    } else if (result.code === 'AWARD_ALREADY_CONVERTED' || result.code === 'REVISION_CONFLICT') {
      await removeAwardLine();
      await offers.refresh();
      setAwardOutcome('converted');
    } else {
      setAwardErrorCode(result.code);
      setAwardOutcome('error');
    }
  };

  const pay = async () => {
    if (isOfferCheckout) {
      await payOffer();
      return;
    }
    // Sandbox creates its simulated payment with the order; it cannot bind a
    // real rail. A Locks checkout binds none either (`locksCheckoutRoute`).
    const method = isSandbox || isLocksCheckout ? null : selectedMethod;
    setPayRefusal(null);
    const result = await checkout.pay(method, () => void pay());
    if (!result.ok) {
      if (result.paykitUnavailable) markPaykitRefused();
      if (result.refusal) setPayRefusal(result.refusal);
      if (result.soldOut) stock.refresh();
      setRailRefresh((refresh) => refresh + 1);
      return;
    }
    setPayingOrderIds(result.orderIds);
    if (result.orderIds[0]) {
      window.history.replaceState(null, '', withBasePath(getMarketplaceCheckoutRoute(result.orderIds[0])));
    }
    const fiatBound = result.boundOrders.filter((order) => order.fiatCheckoutUrl);
    if (fiatBound.length === 1 && fiatBound[0].fiatCheckoutUrl) {
      navigateTop(fiatBound[0].fiatCheckoutUrl);
      return;
    }
    await orders.refresh();
  };

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-28"
    >
      <MarketplaceDeliveryKeyChangeDialog
        change={checkout.pendingKeyChange ?? offerPay.pendingKeyChange}
        onDecision={checkout.pendingKeyChange ? checkout.decideKeyChange : offerPay.decideKeyChange}
      />
      {buyerConnectionOpen && currentUserPubky && (
        <MarketplaceBuyerBitkitConnectDialog
          open
          buyerPubky={currentUserPubky}
          state={buyerWallet.state}
          canPayWithPaypal={canPayWithPaypal}
          onOpenChange={(open) => setBuyerConnection({ owner: currentUserPubky, open })}
          onRecheck={() => buyerWallet.recheck()}
        />
      )}
      <Container
        overrideDefaults
        className="flex w-full flex-col gap-6"
        data-surface="marketplace-checkout"
        data-testid="marketplace-checkout"
      >
        <MarketplaceSectionNav />
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
              Checkout
            </Heading>
            <Typography as="p" className="mt-2 text-muted-foreground">
              {showPaying
                ? 'Review your items and payment status.'
                : isOfferCheckout && offerEligible && award
                  ? `Checkout window closes ${formatDateTime(new Date(award.convertBy))}`
                  : `Enter delivery details and choose how to pay.${
                      checkout.orderCount > 1 ? ' Each order requires a separate payment.' : ''
                    }`}
            </Typography>
          </div>
          <div className="w-full justify-self-end md:w-auto">
            <MarketplaceCheckoutSteps
              currentStep={showPaying || awardOutcome === 'success' ? 3 : 2}
              completed={allPaymentsConfirmed}
            />
          </div>
        </div>

        {awardOutcome && isOfferCheckout ? (
          <MarketplaceAwardOutcome
            outcome={awardOutcome}
            award={award}
            errorCode={awardErrorCode}
            listingRoute={listingRoute}
            onRetry={() => setAwardOutcome(null)}
          />
        ) : showPaying ? (
          <div className="grid gap-4" data-testid="marketplace-checkout-paying">
            {holdCopy &&
              !allPaymentsConfirmed &&
              !(headerOrder?.paymentMethod === 'paypal' && headerView?.payment?.state === 'awaiting_entitlement') && (
                <Typography as="p" className="rounded-md bg-card/60 px-4 py-3 text-sm">
                  {holdCopy}
                </Typography>
              )}
            {orders.isLoading && focusedPaying.length === 0 ? (
              <Skeleton className="h-40 w-full" aria-label="Loading checkout" />
            ) : focusedPaying.length === 0 ? (
              <Card className="rounded-md p-0">
                <CardContent className="grid gap-3 p-6">
                  <Typography as="p">This checkout is no longer waiting for payment.</Typography>
                  <Button asChild className="w-fit rounded-full">
                    <Link href={MARKETPLACE_ROUTES.ORDERS} overrideDefaults>
                      View orders
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              focusedPaying.map(({ order, payment }) => (
                <Card className="rounded-md p-0" key={order.id}>
                  <CardContent className="grid min-w-0 gap-4 p-6">
                    <MarketplaceOrderReference order={order} isBuyer />
                    <MarketplaceCheckoutStatusLabels order={order} payment={payment} isSandbox={isSandbox} />
                    {order.lines.map((line, index) => (
                      <MarketplaceCheckoutItem
                        key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                        line={line}
                      />
                    ))}
                    {(payment?.state !== 'confirmed' || observedPaymentRail(order) === 'usdt') && (
                      <MarketplacePaymentStatusCard
                        order={order}
                        payment={payment}
                        isBuyer
                        adapterMode={adapterMode}
                        advancePayment={orders.advancePayment}
                        onPaymentChanged={orders.refresh}
                        showStagingNotice={false}
                        showStatusLabels={false}
                        checkoutActions={
                          order.state === 'pending_payment' &&
                          (order.paymentMethod === 'paypal' || paykitCheckoutCancellable(order)) ? (
                            <MarketplaceOrderActions
                              order={order}
                              isBuyer
                              canEditReview={false}
                              cancelButtonSize="default"
                              actOnOrder={orders.actOnOrder}
                              onChanged={orders.refresh}
                            />
                          ) : undefined
                        }
                      />
                    )}
                  </CardContent>
                </Card>
              ))
            )}
            {isStaging && !isSandbox && (
              <Typography
                as="p"
                role="note"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
              >
                {focusedPaying.some(
                  ({ order }) => orderMayPayInUsdt(order) || unboundOrderMayPayInUsdt(order, resumeOfferedAssets),
                )
                  ? STAGING_USDT_FUNDS_NOTE
                  : 'Staging environment. No real funds move.'}
              </Typography>
            )}
          </div>
        ) : cart.isLoading || (isOfferCheckout && offers.isLoading) || dropLoadState === 'loading' ? (
          <MarketplaceCartSkeleton />
        ) : isOfferCheckout && !offerEligible ? (
          <Card className="rounded-md p-0">
            <CardContent className="grid gap-3 p-6">
              <Heading level={2} size="lg">
                Checkout unavailable
              </Heading>
              <Typography as="p">Checkout for this offer is unavailable right now.</Typography>
              <Link href={APP_ROUTES.MARKETPLACE} overrideDefaults>
                Browse the market
              </Link>
            </CardContent>
          </Card>
        ) : dropLoadState === 'missing' || (!isOfferCheckout && checkoutItems.length === 0) ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md text-center">
            <Heading level={2} size="md">
              Nothing to check out
            </Heading>
            <Typography as="p" className="mt-2 text-muted-foreground">
              {isDropCheckout ? 'This drop listing could not be loaded.' : 'Add items in your cart first.'}
            </Typography>
            <Button asChild className="mt-6 rounded-full">
              <Link href={backHref} overrideDefaults>
                {backLabel}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1">
              {availableCheckoutMethods.includes('paykit') && (
                <Typography
                  as="p"
                  size="sm"
                  className="text-muted-foreground lg:hidden"
                  data-testid="marketplace-checkout-bitkit-notice"
                >
                  {paykitRequirementCopy(paykitAssets)}
                </Typography>
              )}
              {isOfferCheckout && award ? <MarketplaceAwardTerms award={award} /> : null}
              {fulfillmentGroups.map((group) => {
                const fulfillmentOptions = checkout.fulfillmentOptionsForSeller(group.sellerPubky);
                const fulfillment = checkout.fulfillmentForSeller(group.sellerPubky);
                const isPickupGroup = fulfillment === 'pickup';
                const isPickupCapabilityLoading = checkout.isPickupCapabilityLoadingForSeller(group.sellerPubky);
                // A shipping-only award has no fulfillment step to show.
                const hasFulfillmentStep =
                  isPickupCapabilityLoading || isPickupGroup || fulfillmentOptions.length !== 1;
                if (group.items.length === 0 && !hasFulfillmentStep) return null;
                // The award group has no cart lines and always ships or is picked up.
                const shipsOrPicksUp =
                  group.items.length === 0 ||
                  group.items.some((item) => checkout.fulfillmentForItem(item.id) !== 'digital');
                return (
                  <section
                    key={group.sellerPubky}
                    className="grid gap-3"
                    aria-label={`Items from ${group.sellerPubky}`}
                    data-surface={isPickupGroup ? 'checkout-pickup-group' : undefined}
                  >
                    {isPickupCapabilityLoading ? (
                      <Skeleton
                        className="h-16 w-full"
                        data-testid="pickup-capability-skeleton"
                        aria-label="Checking pickup availability"
                      />
                    ) : null}
                    {!isPickupCapabilityLoading && fulfillmentOptions.length > 1 && fulfillment && (
                      <div className="flex flex-wrap items-center gap-3 rounded-md bg-card/60 px-4 py-3">
                        <Label htmlFor={`fulfillment-${group.sellerPubky}`}>Fulfillment</Label>
                        <Select
                          value={fulfillment}
                          onValueChange={(value) => {
                            if (value === 'shipping' || value === 'pickup') {
                              checkout.setFulfillmentChoice(group.sellerPubky, value);
                            }
                          }}
                        >
                          <SelectTrigger
                            theme="secondary"
                            id={`fulfillment-${group.sellerPubky}`}
                            className="w-56"
                            aria-label={`Fulfillment for items from ${group.sellerPubky}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {fulfillmentOptions.includes('shipping') && (
                              <SelectItem value="shipping">Ship it</SelectItem>
                            )}
                            {fulfillmentOptions.includes('pickup') && (
                              <SelectItem value="pickup">Local pickup</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {!isPickupCapabilityLoading && isPickupGroup && (
                      <Typography as="p" className="rounded-md bg-card/60 px-4 py-3 text-sm text-muted-foreground">
                        Local pickup — no delivery address or shipping for these items. The meeting point is revealed
                        after payment confirms.
                      </Typography>
                    )}
                    {!isPickupCapabilityLoading &&
                      !checkout.isDigitalCapabilityLoading &&
                      shipsOrPicksUp &&
                      fulfillmentOptions.length === 0 && (
                        <Typography
                          as="p"
                          role="alert"
                          className="rounded-md border border-destructive/40 px-4 py-3 text-sm"
                        >
                          {isOfferCheckout
                            ? 'This listing is local pickup only, and pickup is unavailable on this deployment right now.'
                            : "These items can't be checked out together: they don't share a fulfillment method this deployment supports (one ships while another is pickup-only). Remove one in the cart to continue."}
                        </Typography>
                      )}
                    {group.items.map((item) => {
                      const variant = item.listing.record.variants.find(({ id }) => id === item.variantId);
                      const price = commerceVariantUnitPrice(item.listing.record, variant);
                      const listingRoute = getMarketplaceListingRoute(
                        item.listing.record.ownerPubky,
                        item.listing.listing_id,
                      );
                      const coverUrl = checkoutMediaUrls[checkoutItems.findIndex(({ id }) => id === item.id)] ?? null;
                      const variantLabel = variant ? Object.values(variant.options).filter(Boolean).join(' · ') : '';
                      const lineStock = stock.stockFor(item.id);
                      return (
                        <Card key={item.id} className="rounded-md p-0">
                          <CardContent className="flex flex-wrap items-center gap-4 p-6">
                            <Link href={listingRoute} overrideDefaults aria-label={`View ${item.listing.record.title}`}>
                              <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand/15">
                                <ShoppingCart className="size-7 text-brand" />
                                {coverUrl && (
                                  <Image
                                    src={coverUrl}
                                    alt={item.listing.record.title}
                                    fill
                                    sizes="80px"
                                    className="absolute inset-0 object-cover object-center"
                                  />
                                )}
                              </div>
                            </Link>
                            <div className="min-w-0 flex-1">
                              <Typography as="h2" className="truncate font-semibold">
                                <Link href={listingRoute} overrideDefaults className="hover:text-brand">
                                  {item.listing.record.title}
                                </Link>
                              </Typography>
                              <MarketplaceSellerLink sellerPubky={group.sellerPubky} />
                              {(variantLabel || item.quantity > 1) && (
                                <Typography as="p" className="text-sm text-muted-foreground">
                                  {variantLabel}
                                  {variantLabel && item.quantity > 1 ? ' · ' : ''}
                                  {item.quantity > 1 ? `Quantity ${item.quantity}` : ''}
                                </Typography>
                              )}
                              {price && (
                                <Typography as="p" className="mt-1 font-bold text-brand">
                                  {formatCommerceMoney(price)}{' '}
                                  {!hideBitcoinEstimate && (
                                    <MarketplaceIndicativePrice money={price} className="font-normal" />
                                  )}
                                </Typography>
                              )}
                              {lineStock && (
                                <Badge
                                  variant="outline"
                                  className="mt-2 border-destructive/50 text-destructive"
                                  data-testid="marketplace-checkout-line-sold-out"
                                >
                                  {cartLineStockLabel(lineStock)}
                                </Badge>
                              )}
                              {checkout.fulfillmentForItem(item.id) === 'digital' && (
                                <Typography
                                  as="p"
                                  role={checkout.digitalKindForItem(item.id) === null ? 'alert' : undefined}
                                  className="mt-1 text-sm text-muted-foreground"
                                  data-testid="checkout-digital-line"
                                >
                                  {digitalCheckoutLineLabel(checkout.digitalKindForItem(item.id))}
                                </Typography>
                              )}
                            </div>
                            {checkout.canChooseDigitalForItem(item.id) && (
                              <Select
                                value={checkout.fulfillmentForItem(item.id) === 'digital' ? 'digital' : 'physical'}
                                onValueChange={(value) => checkout.setDigitalChoice(item.id, value === 'digital')}
                              >
                                <SelectTrigger
                                  theme="secondary"
                                  className="w-full shrink-0 sm:w-44"
                                  aria-label={`Delivery for ${item.listing.record.title}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="physical">{DIGITAL_CHECKOUT_COPY.physicalOption}</SelectItem>
                                  <SelectItem value="digital">{DIGITAL_CHECKOUT_COPY.digitalOption}</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </section>
                );
              })}

              {approvalNeeded && <MarketplaceSessionRequiredCard />}

              {region.needsCountryField && (
                <section className="grid min-w-0 gap-4 rounded-md bg-card p-6 shadow-lg" aria-label="Your country">
                  <BuyerCountryField
                    value={region.buyerCountry}
                    onChange={region.setBuyerCountry}
                    id="checkout-buyer-country"
                  />
                </section>
              )}

              {checkout.requiresDeliveryAddress && (
                <section className="grid min-w-0 gap-6 rounded-md bg-card p-6 shadow-lg" aria-label="Delivery address">
                  <Heading level={2} size="sm" className="text-xl font-semibold">
                    Delivery address
                  </Heading>
                  <SettingsSectionContent>
                    {checkout.addresses.length > 0 && (
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="checkout-address-picker">Saved addresses</Label>
                          <Link
                            href={MARKETPLACE_ROUTES.SETTINGS_ADDRESSES}
                            overrideDefaults
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            Manage
                          </Link>
                        </div>
                        <Select
                          value={checkout.selectedAddressId ?? 'new'}
                          onValueChange={(value) => checkout.selectAddress(value === 'new' ? null : value)}
                        >
                          <SelectTrigger theme="secondary" id="checkout-address-picker" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {checkout.addresses.map((address) => (
                              <SelectItem key={address.id} value={address.id}>
                                {address.label} · {address.city}
                                {address.is_default ? ' (default)' : ''}
                              </SelectItem>
                            ))}
                            <SelectItem value="new">New address</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <ControlledInputField name="name" control={checkout.form.control} label="Full name" />
                    <MarketplaceAddressFields
                      control={checkout.form.control}
                      setValue={checkout.form.setValue}
                      allowedCountries={checkout.allowedDestinationCountries}
                    />
                    <MarketplaceCheckoutStoreShare
                      stores={checkout.storeShare.stores}
                      chosen={checkout.storeShare.chosen}
                      onChange={checkout.storeShare.setShare}
                    />
                    <div className="grid gap-4">
                      <Typography as="p" className="text-sm text-muted-foreground">
                        {MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE}
                      </Typography>
                      {checkout.selectedAddressId === null && (
                        <div className="grid gap-3">
                          <Controller
                            name="saveAddress"
                            control={checkout.form.control}
                            render={({ field }) => (
                              <Label className="items-start gap-3">
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                <span>Save this address on this device for next time</span>
                              </Label>
                            )}
                          />
                          {checkout.form.watch('saveAddress') && (
                            <ControlledInputField
                              name="saveLabel"
                              control={checkout.form.control}
                              label="Label"
                              placeholder="Home"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </SettingsSectionContent>
                </section>
              )}

              {checkout.requiresDeliveryEmail && (
                <section
                  className="grid min-w-0 gap-6 rounded-md bg-card p-6 shadow-lg"
                  aria-label={DIGITAL_CHECKOUT_COPY.emailHeading}
                  data-surface="checkout-delivery-email"
                >
                  <Heading level={2} size="sm" className="text-xl font-semibold">
                    {DIGITAL_CHECKOUT_COPY.emailHeading}
                  </Heading>
                  <Typography as="p" className="rounded-md bg-card/60 px-4 py-3 text-sm text-muted-foreground">
                    {DIGITAL_CHECKOUT_COPY.emailDisclosure}
                  </Typography>
                  <SettingsSectionContent>
                    <ControlledInputField
                      name="deliveryEmail"
                      control={checkout.form.control}
                      label="Email"
                      placeholder="you@example.com"
                      maxLength={DELIVERY_EMAIL_MAX_CHARS}
                    />
                  </SettingsSectionContent>
                </section>
              )}
            </div>

            <div className="grid min-w-0 gap-4 lg:col-start-2 lg:row-start-1 lg:self-start">
              <Card className="h-fit rounded-md p-0 shadow-lg" data-testid="marketplace-checkout-summary">
                <CardContent className="grid min-w-0 gap-6 p-6">
                  <section className="grid min-w-0 gap-6" aria-label="Order summary">
                    <Heading level={2} size="sm" className="text-xl font-semibold">
                      Order summary
                    </Heading>
                    <SettingsSectionContent>
                      <div className="grid gap-6">
                        <div className="flex justify-between">
                          <Typography as="span">Items</Typography>
                          <div className="flex flex-col items-end">
                            {itemSubtotals.map((subtotal) => (
                              <Typography
                                key={`${subtotal.currency}:${subtotal.exponent}`}
                                as="span"
                                className="flex flex-col items-end font-bold"
                              >
                                {formatCommerceMoney(subtotal)}
                                {!hideBitcoinEstimate && (
                                  <MarketplaceIndicativePrice money={subtotal} className="font-normal" />
                                )}
                              </Typography>
                            ))}
                          </div>
                        </div>
                        <hr className="m-0 border-border" />
                        <div className="grid gap-1">
                          <div className="flex justify-between">
                            <Typography as="span" className="text-foreground">
                              {allDigital ? 'Delivery' : 'Shipping'}
                            </Typography>
                            {shippingTotals.length > 0 && (
                              <div className="flex flex-col items-end">
                                {shippingTotals.map((subtotal) => (
                                  <Typography
                                    key={`${subtotal.currency}:${subtotal.exponent}`}
                                    as="span"
                                    className="flex flex-col items-end font-bold"
                                  >
                                    {formatCommerceMoney(subtotal)}
                                    {!hideBitcoinEstimate && (
                                      <MarketplaceIndicativePrice money={subtotal} className="font-normal" />
                                    )}
                                  </Typography>
                                ))}
                              </div>
                            )}
                          </div>
                          {(shipping.hasCalculatedShipping ||
                            shippingTotals.length === 0 ||
                            allPickup ||
                            allDigital) && (
                            <Typography as="p" className="text-xs text-muted-foreground">
                              {shipping.hasCalculatedShipping || checkout.requiresDeliveryAddress
                                ? 'Shipping is calculated at checkout.'
                                : allPickup
                                  ? 'No shipping — pickup is arranged with the seller after payment.'
                                  : allDigital
                                    ? DIGITAL_CHECKOUT_COPY.noShippingDigital
                                    : DIGITAL_CHECKOUT_COPY.noShippingMixed}
                            </Typography>
                          )}
                        </div>
                        <hr className="m-0 border-border" />
                        <div className="flex justify-between">
                          <Typography as="span" className="font-semibold">
                            {isOfferCheckout ? 'Merchandise total' : 'Total'}
                          </Typography>
                          <div className="flex flex-col items-end">
                            {totalSubtotals.map((subtotal) => (
                              <Typography
                                key={`${subtotal.currency}:${subtotal.exponent}`}
                                as="span"
                                className="flex flex-col items-end font-bold"
                              >
                                {formatCommerceMoney(subtotal)}
                                {!hideBitcoinEstimate && (
                                  <MarketplaceIndicativePrice money={subtotal} className="font-normal" />
                                )}
                              </Typography>
                            ))}
                          </div>
                        </div>
                        <MarketplaceDeliveryTerms entries={sellerDeliveryTerms.entries} />
                      </div>
                    </SettingsSectionContent>
                  </section>
                  <section
                    className="grid min-w-0 gap-6"
                    aria-label="Payment method"
                    data-testid="marketplace-checkout-payment-method"
                  >
                    <Heading level={2} size="sm" className="text-xl font-semibold">
                      Payment method
                    </Heading>
                    <SettingsSectionContent className="gap-6">
                      {railsFailed ? (
                        <div role="alert" className="flex flex-wrap items-center gap-3">
                          <Typography as="p" className="text-sm text-muted-foreground">
                            Couldn&apos;t load payment options.
                          </Typography>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="rounded-full"
                            data-testid="marketplace-checkout-methods-retry"
                            onClick={() => setRailAttempt((attempt) => attempt + 1)}
                          >
                            Retry
                          </Button>
                        </div>
                      ) : sharedMethods === null ? (
                        <Skeleton className="h-11 w-full" aria-label="Loading payment methods" />
                      ) : paykitOutageForCart && sharedMethods.length === 0 ? (
                        <PaykitOutageNotice audience="buyer" surface="checkout-paykit-outage" />
                      ) : sharedMethods.length === 0 && !isSandbox ? (
                        <Typography as="p" role="alert" className="text-sm text-muted-foreground">
                          {isMultiSeller
                            ? 'These sellers do not share a payment method, so Pay stays disabled. Remove a seller in the cart or ask them to add a shared rail.'
                            : "This seller hasn't set up a payment method this cart can use, so Pay stays disabled. Message the seller to ask them to add one."}
                        </Typography>
                      ) : (
                        <div className="grid grid-cols-2 gap-3" role="group" aria-label="Payment method">
                          {availableCheckoutMethods.map((method) => (
                            <Button
                              key={method}
                              type="button"
                              variant={selectedMethod === method ? 'default' : 'secondary'}
                              className="h-20 w-full gap-3 rounded-md px-4 text-base whitespace-normal"
                              aria-pressed={selectedMethod === method}
                              data-testid={`marketplace-checkout-method-${method}`}
                              onClick={() => setSelectedMethod(method)}
                            >
                              {method === 'paykit' && <WalletCards className="size-6 shrink-0" aria-hidden="true" />}
                              {method === 'paypal' && <HandCoins className="size-6 shrink-0" aria-hidden="true" />}
                              <MethodLabel method={method} paykitAssets={paykitAssets} />
                            </Button>
                          ))}
                        </div>
                      )}
                      {paykitOutageForCart && sharedMethods !== null && sharedMethods.length > 0 && (
                        <Typography as="p" aria-live="polite" className="text-sm text-muted-foreground">
                          {PAYKIT_OUTAGE_COPY.title} {PAYKIT_OUTAGE_COPY.buyerOthers}
                        </Typography>
                      )}
                      {paykitChosen && (
                        <Typography
                          as="p"
                          size="sm"
                          className="text-muted-foreground"
                          data-testid="marketplace-checkout-paykit-requirement"
                        >
                          {paykitRequirementCopy(paykitAssets)}
                        </Typography>
                      )}
                      {usdtMissingExplanation && <MarketplaceUsdtMissingNote explanation={usdtMissingExplanation} />}
                      {paykitChosen && paykitOffersUsdt && (
                        <div className="grid gap-1" data-testid="marketplace-checkout-paykit-note">
                          {usdtMillionths !== null && (
                            <Typography as="p" className="text-sm" data-testid="marketplace-checkout-usdt-amount">
                              {formatUsdt(usdtMillionths)} · {USDT_NETWORK_LABEL} if you pay in USDT
                            </Typography>
                          )}
                          <Typography as="p" className="text-xs text-muted-foreground">
                            {USDT_WALLET_HINT}
                          </Typography>
                          {usdtFulfilmentWaitsForFinality(lineMethods) && (
                            <Typography
                              as="p"
                              className="text-xs text-muted-foreground"
                              data-testid="marketplace-checkout-usdt-finality-note"
                            >
                              {PAYKIT_USDT_FINALITY_EXPECTATION_COPY}
                            </Typography>
                          )}
                          {isMultiSeller && (
                            <Typography
                              as="p"
                              className="text-xs text-muted-foreground"
                              data-testid="marketplace-checkout-usdt-multi-seller-note"
                            >
                              {USDT_MULTI_SELLER_COPY}
                            </Typography>
                          )}
                        </div>
                      )}
                      {buyerWalletChecking && (
                        <Typography as="p" aria-live="polite" className="text-xs text-muted-foreground">
                          Checking your Bitkit wallet…
                        </Typography>
                      )}
                      {buyerWalletMissing && (
                        <div
                          role="alert"
                          className="grid gap-4 rounded-md border bg-card/60 p-6"
                          data-testid="marketplace-checkout-bitkit-required"
                        >
                          <Typography as="p" className="text-sm font-medium">
                            {supportsBuyerConnectionGuide
                              ? 'Connect Bitkit to pay with Paykit'
                              : BITCOIN_WALLET_FORK_REQUIRED_TITLE}
                          </Typography>
                          {supportsBuyerConnectionGuide && <BitkitDownloads compact />}
                          <Typography as="p" className="text-sm text-muted-foreground">
                            {supportsBuyerConnectionGuide
                              ? 'Use your marketplace pubky in Bitkit to receive a payment request.'
                              : BITCOIN_WALLET_FORK_REQUIRED_COPY}
                          </Typography>
                          <div className="flex flex-wrap gap-2">
                            {supportsBuyerConnectionGuide && (
                              <Button
                                type="button"
                                size="sm"
                                data-testid="marketplace-checkout-bitkit-connect"
                                disabled={!currentUserPubky}
                                onClick={() => checkBuyerConnection(true)}
                              >
                                Connect Bitkit
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="rounded-full"
                              data-testid="marketplace-checkout-bitkit-recheck"
                              onClick={() => checkBuyerConnection(false)}
                            >
                              Check connection
                            </Button>
                          </div>
                        </div>
                      )}
                      {buyerWalletUnsupported && (
                        <div
                          role="alert"
                          className="grid gap-2 rounded-xl border bg-card/60 p-4"
                          data-testid="marketplace-checkout-bitkit-unsupported"
                        >
                          <Typography as="p" className="text-sm font-medium">
                            {BITCOIN_WALLET_UNSUPPORTED_TITLE}
                          </Typography>
                          <Typography as="p" className="text-xs text-muted-foreground">
                            {bitcoinWalletUnsupportedBody(canPayWithPaypal)}
                          </Typography>
                        </div>
                      )}
                      {buyerWalletUnverified && (
                        <div
                          role="alert"
                          className="grid gap-2 rounded-xl border bg-card/60 p-4"
                          data-testid="marketplace-checkout-bitkit-unverified"
                        >
                          <Typography as="p" className="text-sm font-medium">
                            {BITCOIN_WALLET_UNVERIFIED_TITLE}
                          </Typography>
                          <Typography as="p" className="text-xs text-muted-foreground">
                            {bitcoinWalletUnverifiedBody(canPayWithPaypal)}
                          </Typography>
                          <div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="rounded-full"
                              data-testid="marketplace-checkout-bitkit-unverified-recheck"
                              disabled={buyerWallet.pending}
                              onClick={() => buyerWallet.recheck({ keepVerdict: true })}
                            >
                              {buyerWallet.pending ? (
                                <>
                                  <LoaderCircle className="size-4 animate-spin" />
                                  Checking…
                                </>
                              ) : (
                                'Check connection'
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                      {allPickup && (
                        <div className="grid gap-3" data-testid="marketplace-checkout-payment-notice-group">
                          <div className="grid gap-1">
                            <Typography as="p" className="text-sm font-medium">
                              Local pickup
                            </Typography>
                            <Typography as="p" className="text-xs text-muted-foreground">
                              No delivery address needed. Pickup location is shared once payment is confirmed.
                            </Typography>
                          </div>
                        </div>
                      )}
                      {checkout.hasInstantDigitalLine && (
                        <Typography
                          as="p"
                          className="text-xs text-muted-foreground"
                          data-testid="checkout-consent-instant"
                        >
                          {DIGITAL_CHECKOUT_COPY.consentInstant}
                        </Typography>
                      )}
                      {checkout.hasManualDigitalLine && (
                        <Typography
                          as="p"
                          className="text-xs text-muted-foreground"
                          data-testid="checkout-consent-manual"
                        >
                          {DIGITAL_CHECKOUT_COPY.consentManual}
                        </Typography>
                      )}
                      <DeliveryKeyBlockedNotice block={checkout.deliveryKeyBlock ?? offerPay.deliveryKeyBlock} />
                      {paymentCodeNote && (
                        <Typography
                          as="p"
                          className="text-xs text-muted-foreground"
                          data-testid="bitcoin-payment-code-note"
                        >
                          {paymentCodeNote}
                        </Typography>
                      )}
                      {payRefusal && (
                        <Typography
                          as="p"
                          role="alert"
                          className="rounded-md border border-destructive/40 px-4 py-3 text-sm"
                          data-testid="marketplace-checkout-pay-refusal"
                        >
                          {payRefusal}
                        </Typography>
                      )}
                      <Button
                        className="w-full rounded-full"
                        onClick={() => void pay()}
                        disabled={!canPay}
                        data-testid="marketplace-checkout-pay"
                        aria-describedby={!canPay ? 'checkout-pay-reason' : undefined}
                      >
                        {isPaying ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" />
                            Paying
                          </>
                        ) : isSandbox ? (
                          'Pay sandbox'
                        ) : selectedMethod ? (
                          CHECKOUT_SUBMIT_LABEL[selectedMethod]
                        ) : (
                          'Pay'
                        )}
                      </Button>
                      {isProduction && !isSandbox && (
                        <Typography
                          as="p"
                          size="xs"
                          className="text-muted-foreground"
                          data-testid="marketplace-checkout-payment-notice"
                        >
                          {isLocksPaykitCommerceMode(adapterMode)
                            ? 'Payment goes directly to the seller. This marketplace never holds funds.'
                            : 'No payment rails are live in this deployment, so no real funds move. This marketplace never holds funds.'}
                        </Typography>
                      )}
                      {region.refusal && (
                        <Typography
                          as="p"
                          role="alert"
                          className="text-sm font-medium"
                          data-testid="checkout-region-refusal"
                        >
                          {region.refusal}
                        </Typography>
                      )}
                      <CheckoutSaleTerms sellerPubkys={checkoutSellers} declarations={region.declarations} />
                      {!canPay && (
                        <Typography id="checkout-pay-reason" as="p" className="text-xs text-muted-foreground">
                          {payDisabledReason}
                        </Typography>
                      )}
                    </SettingsSectionContent>
                  </section>
                </CardContent>
              </Card>
              {isStaging && (
                <Typography
                  as="p"
                  role="note"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                >
                  {stagingUsdtPossible ? STAGING_USDT_FUNDS_NOTE : 'Staging environment. No real funds move.'}
                </Typography>
              )}
            </div>
          </div>
        )}
      </Container>
    </ContentLayout>
  );
}

function dropCheckoutItem(listing: CommerceListingModelSchema, variantId: string): MarketplaceCartItem {
  return {
    id: `${listing.id}:${variantId}:drop`,
    listingId: listing.id,
    variantId,
    quantity: 1,
    listing,
    pricingSource: 'listing',
  };
}

function MarketplaceAwardTerms({ award }: { award: NonNullable<MarketplaceOfferAward> }) {
  const listingRoute = getMarketplaceListingRoute(award.listing.sellerPubky, award.listing.listingId);
  const variantLabel = award.variant.options
    .map((item) => item.value)
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="grid gap-3" aria-label="Accepted offer">
      <Card className="rounded-md p-0">
        <CardContent className="grid gap-2 p-6">
          <Typography as="h2" className="truncate font-semibold">
            <Link href={listingRoute} overrideDefaults className="hover:text-brand">
              {award.listing.title}
            </Link>
          </Typography>
          <MarketplaceSellerLink sellerPubky={award.listing.sellerPubky} />
          <Typography as="p" className="text-sm text-muted-foreground">
            {variantLabel ? `${variantLabel} · ` : ''}Quantity {award.quantity}
          </Typography>
        </CardContent>
      </Card>
    </section>
  );
}

function MarketplaceAwardOutcome({
  outcome,
  award,
  errorCode,
  listingRoute,
  onRetry,
}: {
  outcome: AwardPayOutcome;
  award: MarketplaceOfferAward | undefined;
  errorCode: string | null;
  listingRoute: string | null | undefined;
  onRetry: () => void;
}) {
  if (outcome === 'success') {
    return (
      <Card className="rounded-md p-0">
        <CardContent className="grid gap-4 p-6">
          <Heading level={2} size="lg">
            Checkout started
          </Heading>
          <Typography as="p">
            Your agreed merchandise total is {award ? formatCommerceMoney(award.merchandiseTotal) : ''}.
          </Typography>
        </CardContent>
      </Card>
    );
  }
  if (outcome === 'expired') {
    return (
      <Card className="rounded-md p-0">
        <CardContent className="grid gap-4 p-6">
          <Heading level={2} size="lg">
            Offer expired
          </Heading>
          <Typography as="p">This accepted offer expired before checkout. Nothing was reserved.</Typography>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" className="rounded-full">
              <Link href={MARKETPLACE_ROUTES.OFFERS} overrideDefaults>
                View offers
              </Link>
            </Button>
            {listingRoute && (
              <Button asChild className="rounded-full">
                <Link href={listingRoute} overrideDefaults>
                  Buy at current price
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
  if (outcome === 'converted') {
    return (
      <Card className="rounded-md p-0">
        <CardContent className="grid gap-4 p-6">
          <Heading level={2} size="lg">
            Offer already converted
          </Heading>
          <Typography as="p">This accepted offer has already been converted.</Typography>
          <Button asChild className="w-fit rounded-full">
            <Link href={MARKETPLACE_ROUTES.ORDERS} overrideDefaults>
              View orders
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (outcome === 'unavailable') {
    return (
      <Card className="rounded-md p-0">
        <CardContent className="grid gap-3 p-6">
          <Heading level={2} size="lg">
            Checkout unavailable
          </Heading>
          <Typography as="p">This offer is no longer available.</Typography>
          <Link href={MARKETPLACE_ROUTES.OFFERS} overrideDefaults>
            View offers
          </Link>
        </CardContent>
      </Card>
    );
  }
  if (outcome === 'session') {
    return <MarketplaceSessionRequiredCard />;
  }
  return (
    <Card className="rounded-md p-0">
      <CardContent className="grid gap-4 p-6">
        <Heading level={2} size="lg">
          Checkout could not be completed
        </Heading>
        <Typography as="p">{marketplaceOfferCheckoutFailureMessage(errorCode)}</Typography>
        <Button className="w-fit rounded-full" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
