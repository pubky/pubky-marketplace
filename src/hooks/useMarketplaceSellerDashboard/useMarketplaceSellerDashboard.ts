'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  evaluateListingActivationGuards,
  seedDraftFormFromListing,
} from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing';
import { useMarketplaceOffers } from '@/hooks/useMarketplaceOffers/useMarketplaceOffers';
import { useMarketplaceOrders } from '@/hooks/useMarketplaceOrders/useMarketplaceOrders';
import { cacheProjection } from '@/hooks/useMarketplaceProjection/useMarketplaceProjection';
import { useMeasurementSystem } from '@/hooks/useMeasurementSystem/useMeasurementSystem';
import { isAuctionSaleEnded } from '@/libs/commerce/auction-phase';
import { isLiveAuction } from '@/libs/commerce/auction-removal';
import {
  contentfulListingDrafts,
  formatListingDraftAge,
  listingDraftFormRecord,
  listingDraftHasUserContent,
  listingDraftTitleLabel,
  markListingDraftResumeId,
} from '@/libs/commerce/listing-drafts';
import { listingPublishBlockToast } from '@/libs/commerce/listing-publish-guards';
import { sumMoneyByAsset } from '@/libs/commerce/pricing';
import {
  countableStockQuantity,
  formatListingStock,
  isUnlimitedStock,
  UNLIMITED_STOCK_LABEL,
} from '@/libs/commerce/unlimited-stock';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

const REVENUE_ORDER_STATES = ['paid', 'processing', 'shipped', 'delivered', 'completed'] as const;

/** Shown in place of a listing's stock, and the stock total, while the service has not yet answered for it. */
const STOCK_UNKNOWN_LABEL = '—';

/** What the service said when the dashboard last read a listing: it holds a projection, or it holds none. */
type ServiceRead = 'registered' | 'unregistered';

type LocalListing = Awaited<ReturnType<typeof CommerceController.getListingsBySeller>>[number];

export function useMarketplaceSellerDashboard() {
  const [nowMs, setNowMs] = useState(0);
  const [catalogFetchState, setCatalogFetchState] = useState<'idle' | 'loading' | 'settled' | 'error'>('idle');
  const catalogFetchAttempted = useRef<string | null>(null);
  const catalogRefreshGeneration = useRef(0);
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const measurementSystem = useMeasurementSystem();
  const localListings = useLiveQuery(
    () => (currentUserPubky ? CommerceController.getListingsBySeller(currentUserPubky) : []),
    [currentUserPubky],
  );
  useEffect(() => {
    if (!currentUserPubky || localListings === undefined) return;
    if (catalogFetchAttempted.current === currentUserPubky) return;
    const sellerPubky = currentUserPubky;
    const generation = ++catalogRefreshGeneration.current;
    let active = true;
    catalogFetchAttempted.current = currentUserPubky;
    setCatalogFetchState('loading');
    CommerceController.refreshListingsBySeller(sellerPubky)
      .then(() => {
        if (active && catalogRefreshGeneration.current === generation) setCatalogFetchState('settled');
      })
      .catch(() => {
        if (active && catalogRefreshGeneration.current === generation) setCatalogFetchState('error');
      });
    return () => {
      active = false;
    };
  }, [currentUserPubky, localListings]);
  const orders = useMarketplaceOrders();
  const offers = useMarketplaceOffers();
  const sellerOrders = orders.orders.filter(({ order }) => order.sellerPubky === currentUserPubky);
  const sellerOffers = offers.offers.filter(({ sellerPubky }) => sellerPubky === currentUserPubky);
  // The Inventory column shows the service's count, which moves with each
  // sale; the cached projection is only refreshed where a listing is opened.
  // It is read again whenever a seller order moves or the session changes.
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const stockRefreshed = useRef<string | null>(null);
  const [serviceReads, setServiceReads] = useState<ReadonlyMap<string, ServiceRead>>(new Map());
  // A read that failed (offline, a session the service had not yet accepted) is tried again when the tab
  // regains focus, instead of leaving the dashboard on the record's own numbers until a reload.
  const [stockRetry, setStockRetry] = useState(0);
  const stockReadFailed = useRef(false);
  useEffect(() => {
    const retry = () => {
      if (stockReadFailed.current) setStockRetry((attempt) => attempt + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  const stockKey = [
    currentUserPubky,
    marketplaceSession?.issuedAt,
    stockRetry,
    ...sellerOrders.map(({ order }) => `${order.id}:${order.revision}:${order.state}`),
  ].join('|');
  useEffect(() => {
    if (!currentUserPubky || !marketplaceSession || catalogFetchState !== 'settled') return;
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return;
    if (stockRefreshed.current === stockKey) return;
    stockRefreshed.current = stockKey;
    const sellerPubky = currentUserPubky;
    stockReadFailed.current = false;
    void (async () => {
      for (const listing of await CommerceController.getListingsBySeller(sellerPubky)) {
        try {
          const projection = await CommerceController.getMarketplaceListingProjection(sellerPubky, listing.listing_id);
          if (projection) await cacheProjection(projection);
          setServiceReads((reads) => new Map(reads).set(listing.id, projection ? 'registered' : 'unregistered'));
        } catch {
          stockReadFailed.current = true;
        }
      }
    })();
  }, [currentUserPubky, marketplaceSession, catalogFetchState, stockKey]);
  const activeListings = (localListings ?? []).filter(
    (listing) => listing.state === 'active' && !isAuctionSaleEnded(listing.record.sale, nowMs),
  );
  const expiringBefore = nowMs + 24 * 60 * 60 * 1_000;
  const expiringAuctions = activeListings.filter((listing) => {
    if (listing.record.sale.format !== 'auction') return false;
    const endsAt = Date.parse(listing.record.sale.endsAt);
    return endsAt > nowMs && endsAt <= expiringBefore;
  }).length;
  const ordersToShip = sellerOrders.filter(({ order }) => order.state === 'paid').length;
  const offersAwaitingReply = sellerOffers.filter(
    ({ state, offeredBy }) => (state === 'pending' || state === 'countered') && offeredBy !== currentUserPubky,
  ).length;
  const durable = isDurableCommerceMode(getCommerceAdapterMode());
  // Whether the service has told this dashboard about the listing: a cached projection, or an answer just now.
  const serviceAnswered = (listing: { id: string; registeredWithService: boolean }) =>
    !durable || listing.registeredWithService || serviceReads.has(listing.id);
  // Offered only once the service said it holds no projection: before that the dashboard does not know.
  const canOfferRegistration = (listing: { id: string }) => !durable || serviceReads.get(listing.id) === 'unregistered';
  const hasUnlimitedStock = (listing: LocalListing) =>
    listing.record.variants.some((variant) => isUnlimitedStock(listing.record, variant.quantity));
  // Unlimited stock is the record's own setting; a finite count is the service's, so it waits for an answer.
  const isStockKnown = (listing: LocalListing) => hasUnlimitedStock(listing) || serviceAnswered(listing);
  const listingStockLabel = (listing: LocalListing) =>
    isStockKnown(listing) ? formatListingStock(listing.record, listing.purchasableQuantity) : STOCK_UNKNOWN_LABEL;
  const stockKnown = activeListings.every(isStockKnown);
  const finiteInventory = activeListings.reduce((total, listing) => {
    const record = listing.record;
    if (hasUnlimitedStock(listing)) return total + countableStockQuantity(record);
    return (
      total +
      (listing.purchasableQuantity ??
        record.variants.reduce((sum, variant) => sum + (variant.enabled ? variant.quantity : 0), 0))
    );
  }, 0);
  const unlimitedActive = activeListings.some(hasUnlimitedStock);
  const totalInventory = !stockKnown
    ? STOCK_UNKNOWN_LABEL
    : finiteInventory === 0 && unlimitedActive
      ? UNLIMITED_STOCK_LABEL
      : finiteInventory;
  // One revenue figure per pricing asset: minor units of different assets
  // (USD cents, bitcoin base units) are never summed into one false number.
  const revenueOrders = sellerOrders.filter(({ order }) =>
    (REVENUE_ORDER_STATES as readonly string[]).includes(order.state),
  );
  const revenue = sumMoneyByAsset(revenueOrders.map(({ order }) => ({ money: order.total, quantity: 1 })));

  const updateListingState = async (listingIds: string[], state: 'active' | 'paused') => {
    // Pausing pulls the terms bidders acted on, which the listing page refuses for a live auction too.
    const selected = (localListings ?? []).filter(
      ({ id, record }) => listingIds.includes(id) && !(state === 'paused' && isLiveAuction(record, Date.now())),
    );
    if (selected.length === 0) return false;
    if (state === 'active') {
      // Read at call time: the dashboard calls this straight from the session
      // dialog's onConnected, before a re-render would refresh a selector value.
      const blocked = await evaluateListingActivationGuards({
        ownerPubky: currentUserPubky,
        hasMarketplaceSession: Boolean(useCommerceStore.getState().marketplaceSession),
        records: selected.map(({ record }) => record),
      });
      if (blocked) {
        toast(listingPublishBlockToast(blocked));
        return false;
      }
    }
    try {
      await Promise.all(
        selected.map(({ record }) =>
          CommerceController.commitUpsertListing({
            ...record,
            revision: record.revision + 1,
            state,
            updatedAt: new Date().toISOString(),
          }),
        ),
      );
      toast({ title: state === 'active' ? 'Listings activated' : 'Listings paused' });
      return true;
    } catch {
      toast({ variant: 'error', description: 'Could not update selected listings.' });
      return false;
    }
  };

  const retryListingRegistration = async (listingId: string): Promise<boolean> => {
    const listing = (localListings ?? []).find((candidate) => candidate.listing_id === listingId);
    if (!listing) return false;
    const registered = await CommerceController.ensureListingRegistered(listing.record);
    toast(
      registered
        ? { title: 'Listing registered for checkout' }
        : { description: 'Published, but not yet registered for checkout — retry from your listing' },
    );
    return registered;
  };

  const duplicateListing = async (
    listingId: string,
    options: { replaceUnsavedDraft?: boolean; unsavedDraftId?: string | null } = {},
  ): Promise<boolean> => {
    if (!currentUserPubky) return false;
    try {
      const unsavedDraftId =
        options.unsavedDraftId !== undefined ? options.unsavedDraftId : await unsavedListingDraftId();
      if (unsavedDraftId && !options.replaceUnsavedDraft) return false;
      const record = await CommerceController.getOrFetchListing(currentUserPubky, listingId);
      if (record.ownerPubky !== currentUserPubky) {
        toast({ variant: 'error', description: 'You can only duplicate your own listings.' });
        return false;
      }
      const draftId = crypto.randomUUID().replaceAll('-', '');
      const form = seedDraftFormFromListing(record, measurementSystem);
      await CommerceController.commitUpdateListingDraft(draftId, form);
      markListingDraftResumeId(draftId);
      if (unsavedDraftId && options.replaceUnsavedDraft) {
        try {
          await CommerceController.commitDeleteListingDraft(unsavedDraftId);
        } catch {
          // Newest draft is drafts[0]; leaving the old row is safe.
        }
      }
      return true;
    } catch {
      toast({ variant: 'error', description: 'Could not duplicate this listing.' });
      return false;
    }
  };

  const listingDraftRows = useLiveQuery(
    () => (currentUserPubky ? CommerceController.getListingDrafts() : []),
    [currentUserPubky],
  );
  const unfinishedDrafts = contentfulListingDrafts(listingDraftRows ?? []).map((draft) => {
    const form = listingDraftFormRecord(draft);
    return {
      listingId: draft.listing_id,
      title: listingDraftTitleLabel(form?.title),
      updatedAt: draft.updated_at,
      ageLabel: nowMs === 0 ? '' : formatListingDraftAge(draft.updated_at, nowMs),
    };
  });

  const discardListingDraft = async (listingId: string): Promise<void> => {
    await CommerceController.commitDeleteListingDraft(listingId);
  };

  const resumeListingDraft = (listingId: string): void => {
    markListingDraftResumeId(listingId);
  };

  const hasUnsavedListingDraft = async (): Promise<string | null> => unsavedListingDraftId();

  /** The canonical import CSV, so an exported file can be edited and imported back. */
  const exportCsv = async (): Promise<Uint8Array | null> => {
    if (!currentUserPubky) return null;
    try {
      return await CommerceController.exportInventoryListingsCsv(currentUserPubky);
    } catch {
      toast({ variant: 'error', description: 'Could not export your listings.' });
      return null;
    }
  };

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return {
    listings: localListings ?? [],
    sellerOrders,
    offers: sellerOffers,
    isLoading:
      localListings === undefined ||
      (localListings.length === 0 && (catalogFetchState === 'idle' || catalogFetchState === 'loading')) ||
      orders.isLoading ||
      offers.isLoading,
    error: catalogFetchState === 'error' ? 'Could not load your listings.' : null,
    // Orders and offers ride the same durable session, so either flag means
    // the dashboard's remote-backed numbers are missing until reconnect.
    needsSession: orders.needsSession || offers.needsSession,
    sessionError: (orders.needsSession ? orders.error : null) ?? (offers.needsSession ? offers.error : null),
    metrics: {
      activeListings: activeListings.length,
      totalInventory,
      lowStock: activeListings.filter((listing) =>
        listing.record.variants.some(
          (variant) => variant.enabled && !isUnlimitedStock(listing.record, variant.quantity) && variant.quantity <= 1,
        ),
      ).length,
      paidOrders: revenueOrders.length,
      revenue,
      openOffers: sellerOffers.filter(({ state }) => state === 'pending' || state === 'countered').length,
    },
    actionNeeded: {
      ordersToShip,
      offersAwaitingReply,
      expiringAuctions,
      total: ordersToShip + offersAwaitingReply + expiringAuctions,
    },
    updateListingState,
    retryListingRegistration,
    canOfferRegistration,
    listingStockLabel,
    duplicateListing,
    hasUnsavedListingDraft,
    unfinishedDrafts,
    discardListingDraft,
    resumeListingDraft,
    exportCsv,
    nowMs,
  };
}

async function unsavedListingDraftId(): Promise<string | null> {
  const drafts = await CommerceController.getListingDrafts();
  const latest = drafts[0];
  if (!latest) return null;
  const form = latest.data.form;
  if (!form || typeof form !== 'object') return null;
  return listingDraftHasUserContent(form as Record<string, unknown>) ? latest.listing_id : null;
}
