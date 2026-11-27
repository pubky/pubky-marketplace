'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCommerceAdapterMode, getCommercePollIntervalMs, isTransactionalCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { classifyCommercePollError, type CommercePollOutcome, startCommercePoller } from '@/libs/commerce/polling';
import { Logger } from '@/libs/logger/logger';
import type { MarketplaceFeedNotification } from '@/pipes/marketplaceNotification/marketplaceNotification.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * Marketplace notifications for the app's GENERAL notification surface
 * (`/profile` list + header/footer badge), already normalized to the
 * redacted feed shape by the controller. Distinct from
 * `useMarketplaceNotifications`, which serves the marketplace's own
 * `/marketplace/notifications` page with raw projections and sandbox
 * preference management.
 *
 * A commerce backend failure never breaks the shared surface: errors are
 * logged and the last successful items stay rendered, exactly like a failed
 * silent refresh of the social list. Read state stays honest per mode — the
 * controller only issues `notification.mark_read` against the sandbox, and
 * durable rows never render as unread. `displayedAsUnread` freezes the
 * unread highlight for rows first seen unread in this mount, mirroring how
 * the social list freezes `lastRead`, so mark-all-read on page entry clears
 * the badge without instantly stripping the highlights the user is looking
 * at.
 */
export function useMarketplaceNotificationFeed() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const enabled = Boolean(currentUserPubky) && isTransactionalCommerceMode(getCommerceAdapterMode());
  const [items, setItems] = useState<MarketplaceFeedNotification[]>([]);
  // Rows that were unread when this mount first saw them keep their highlight
  // until the surface is next opened, even after mark-all-read succeeds.
  const seenUnreadIdsRef = useRef<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async (isActive: () => boolean = () => true): Promise<CommercePollOutcome> => {
    try {
      const fetched = await CommerceController.getMarketplaceFeedNotifications();
      if (!isActive()) return 'stop';
      const seenUnread = new Set(seenUnreadIdsRef.current);
      for (const item of fetched) {
        if (item.isUnread) seenUnread.add(item.id);
      }
      seenUnreadIdsRef.current = seenUnread;
      // Empty-to-empty bails out with the same reference so accounts without
      // marketplace activity never re-render the shared surface.
      setItems((previous) =>
        previous.length === 0 && fetched.length === 0
          ? previous
          : fetched.map((item) =>
              item.kind === 'unrecognized' || !seenUnread.has(item.id) ? item : { ...item, isUnread: true },
            ),
      );
      return 'ok';
    } catch (error) {
      if (!isActive()) return 'stop';
      Logger.warn('Failed to load marketplace notifications for the general surface', { error });
      return classifyCommercePollError(error);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setItems((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    let active = true;
    const poller = startCommercePoller({
      poll: () => refresh(() => active),
      getIntervalMs: getCommercePollIntervalMs,
    });
    return () => {
      active = false;
      poller.stop();
    };
  }, [enabled, marketplaceSession, refresh]);

  /**
   * Sandbox only, enforced by the controller: the durable service has no
   * `notification.mark_read` command, so there this resolves without writing
   * anything (and without pretending to).
   */
  const markAllRead = useCallback(async () => {
    try {
      await CommerceController.markAllMarketplaceNotificationsRead();
    } catch (error) {
      Logger.warn('Failed to mark marketplace notifications read', { error });
    }
  }, []);

  return { items, markAllRead };
}
