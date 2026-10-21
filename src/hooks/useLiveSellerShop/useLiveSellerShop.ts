'use client';

import { useEffect, useState } from 'react';
import {
  COMMERCE_SHOP_EVENT_DEBOUNCE_MS,
  COMMERCE_SHOP_EVENT_RECONNECT_MAX_MS,
  COMMERCE_SHOP_EVENT_RECONNECT_MS,
  COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS,
} from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Logger } from '@/libs/logger/logger';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';

/**
 * Reads one seller's shop record when a page opens and keeps the cached copy
 * current while it stays open, so a seller's saved change (seller type,
 * country, details) reaches pages that render the shop from the live query
 * without a reload. With `live`, it first looks up the cursor of the seller's
 * latest `shop.json` write, then reads the record, then streams the writes
 * after that cursor from the seller's homeserver: a write that lands before
 * the read is in the read, and one after it is in the stream. It also re-reads
 * when the tab comes back into view, since a background tab may have lost the
 * stream. Every failure is quiet: the page keeps the record it has.
 *
 * Returns whether the opening read has settled, for telling a seller with no
 * shop from one still loading.
 */
export function useLiveSellerShop(
  sellerPubky: string,
  { enabled = true, live = true }: { enabled?: boolean; live?: boolean } = {},
): boolean {
  const [settledFor, setSettledFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let reader: ReadableStreamDefaultReader<THomeserverResourceEvent> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let lastFocusRead = Date.now();

    const revalidate = () => {
      void CommerceController.refreshShopOrGetCached(sellerPubky).catch(() => undefined);
    };
    const onEvent = () => {
      clearTimeout(debounce);
      debounce = setTimeout(revalidate, COMMERCE_SHOP_EVENT_DEBOUNCE_MS);
    };
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFocusRead < COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS) return;
      lastFocusRead = now;
      revalidate();
    };

    const run = async () => {
      let cursor: string | null = null;
      if (live) {
        try {
          cursor = await CommerceController.latestShopEventCursor(sellerPubky);
        } catch {
          // Without it the stream replays past writes: one extra read, nothing missed.
        }
      }
      if (!active) return;
      await CommerceController.refreshShopOrGetCached(sellerPubky).catch(() => undefined);
      if (!active) return;
      setSettledFor(sellerPubky);
      lastFocusRead = Date.now();
      if (!live) return;
      let failures = 0;
      while (active) {
        let received = false;
        try {
          const stream = await CommerceController.subscribeShopEvents(sellerPubky, cursor);
          if (!stream) return;
          reader = stream.getReader();
          if (!active) break;
          for (;;) {
            const { done, value } = await reader.read();
            if (done || !active) break;
            received = true;
            failures = 0;
            cursor = value.cursor;
            // A delete is ignored: a missing record may be transient, and the cache keeps the last one.
            if (value.eventType === 'PUT') onEvent();
          }
          if (!received) failures += 1;
        } catch (error) {
          if (!active) return;
          failures += 1;
          // One warning per run of failures: a stream that keeps failing stays quiet while it backs off.
          if (failures === 1) Logger.warn('Shop event stream failed; reconnecting', { error });
        } finally {
          void reader?.cancel().catch(() => {});
          reader = undefined;
        }
        const delay = Math.min(
          COMMERCE_SHOP_EVENT_RECONNECT_MS * 2 ** Math.max(failures - 1, 0),
          COMMERCE_SHOP_EVENT_RECONNECT_MAX_MS,
        );
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, delay);
        });
      }
    };

    void run();
    if (live) {
      document.addEventListener('visibilitychange', onFocus);
      window.addEventListener('focus', onFocus);
    }
    return () => {
      active = false;
      clearTimeout(debounce);
      wake?.();
      void reader?.cancel().catch(() => {});
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, live, sellerPubky]);

  return enabled && settledFor === sellerPubky;
}
