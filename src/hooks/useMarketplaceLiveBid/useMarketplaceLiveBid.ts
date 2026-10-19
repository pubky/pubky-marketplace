'use client';

import { useEffect, useRef, useState } from 'react';
import { getCommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useViewportObserver } from '@/hooks/useViewportObserver/useViewportObserver';
import { projectionReadsSoldOut } from '@/libs/commerce/listing-variants';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

export interface MarketplaceLiveBid {
  currentPrice: CommerceMoney;
  bidCount: number;
}

export interface UseMarketplaceLiveBidResult {
  /** Attach to the card's DOM so the fetch only fires for on-screen cards. */
  ref: (node: HTMLElement | null) => void;
  /** Live auction state, or `null` while unknown (not fetched yet, service unreachable, or mode without a durable backend). */
  bid: MarketplaceLiveBid | null;
  /** Durable listing state, used to replace Buy now on a reserved unit. */
  listingState: 'available' | 'reserved' | 'sold' | null;
  /** True when the service reports the listing sold out, including every size sold out. */
  soldOut: boolean;
}

/**
 * Lazily fetches public live auction state (current bid and bid count)
 * for ONE catalog card from the durable transaction service's public listing
 * projection — the only authoritative source for bids, which the Nexus index
 * deliberately never carries.
 *
 * Cost model: the durable service exposes only per-listing reads
 * (`GET /v1/listings/{aggregate_id}`, no batch endpoint), so an eager fetch
 * per grid row would issue N requests on every catalog render. Instead the
 * card registers an IntersectionObserver via `ref` and fetches when it first
 * scrolls into view (200px pre-fetch margin), so off-screen cards cost
 * nothing.
 *
 * Freshness: a card that stays mounted must not keep offering "Buy now" for a
 * listing that has since sold. After the first read it re-reads, while on
 * screen, when the controller reports something that can have changed the
 * listing's availability (an order of this session moving, the detail page's
 * poll seeing the listing change — see `listingCardRefresh`) and when the
 * window regains focus, the same trigger the detail page's poll uses.
 *
 * Scope: `transaction-service` mode only. The sandbox keeps terms-only cards;
 * its simulated bid state stays on the detail page where it is labeled as
 * such. Failures (no session yet, service unreachable) leave `bid` and
 * `listingState` null and the card falls back to the seller's terms
 * from the index — never a fabricated bid or sold-out claim.
 */
export function useMarketplaceLiveBid(
  sellerPubky: string,
  listingId: string,
  enabled: boolean,
): UseMarketplaceLiveBidResult {
  const isDurableMode = getCommerceAdapterMode() === 'transaction-service';
  const isActive = enabled && isDurableMode;
  const { ref, isVisible } = useViewportObserver({ enabled: isActive });
  const [bid, setBid] = useState<MarketplaceLiveBid | null>(null);
  const [listingState, setListingState] = useState<'available' | 'reserved' | 'sold' | null>(null);
  const [soldOut, setSoldOut] = useState(false);
  const refreshCount = useCommerceStore((state) => state.listingCardRefresh[`${sellerPubky}:${listingId}`] ?? 0);
  const [focusCount, setFocusCount] = useState(0);
  const lastReadKeyRef = useRef<string | null>(null);
  const latestRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isActive || !isVisible) return;
    const onFocus = () => {
      if (lastReadKeyRef.current !== null) setFocusCount((count) => count + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isActive, isVisible]);

  useEffect(() => {
    if (!isActive || !isVisible) return;
    const readKey = `${sellerPubky}:${listingId}:${refreshCount}:${focusCount}`;
    if (lastReadKeyRef.current === readKey) return;
    lastReadKeyRef.current = readKey;
    const request = ++latestRequestRef.current;
    void CommerceController.getMarketplaceListingProjection(sellerPubky, listingId)
      .then((projection) => {
        if (!mountedRef.current || request !== latestRequestRef.current || !projection) return;
        setListingState(projection.state);
        setSoldOut(projectionReadsSoldOut(projection));
        if (!projection.auction) return;
        setBid({
          currentPrice: projection.auction.currentPrice,
          bidCount: projection.auction.bidCount,
        });
      })
      .catch(() => {
        // Degrade to terms-only: the card must never invent bid state, and a
        // missing session or unreachable service is not an error at card level.
      });
  }, [isActive, isVisible, listingId, sellerPubky, refreshCount, focusCount]);

  return { ref, bid, listingState, soldOut };
}
