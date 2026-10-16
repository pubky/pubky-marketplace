'use client';

import { useState } from 'react';
import { Bell, Eye, Gavel, Heart, RefreshCw } from 'lucide-react';
import { getMarketplaceListingRoute } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useCommerceFavorite } from '@/hooks/useCommerceFavorite/useCommerceFavorite';
import { useMarketplaceLiveBid } from '@/hooks/useMarketplaceLiveBid/useMarketplaceLiveBid';
import { useMarketplaceFirstMediaUrl } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { useMarketplaceNotificationFeed } from '@/hooks/useMarketplaceNotificationFeed/useMarketplaceNotificationFeed';
import { useMarketplaceSellerSummary } from '@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary';
import { useMarketplaceWatchAlertFeed } from '@/hooks/useMarketplaceWatchAlertFeed/useMarketplaceWatchAlertFeed';
import { useMarketplaceWatchDetection } from '@/hooks/useMarketplaceWatchDetection/useMarketplaceWatchDetection';
import {
  type MarketplaceWatchlistEntry,
  useMarketplaceWatchlist,
} from '@/hooks/useMarketplaceWatchlist/useMarketplaceWatchlist';
import { useRelativeTime } from '@/hooks/useRelativeTime/useRelativeTime';
import { effectiveListingState } from '@/libs/commerce/auction-phase';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { Logger } from '@/libs/logger/logger';
import { MarketplaceEmptyState } from '@/molecules/Marketplace/MarketplaceEmptyState';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import { MarketplaceReauthDialog } from '@/organisms/Marketplace/MarketplaceReauthDialog';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceNotificationItem } from '@/organisms/MarketplaceNotificationItem/MarketplaceNotificationItem';
import { MarketplaceWatchAlertItem } from '@/organisms/MarketplaceWatchAlertItem/MarketplaceWatchAlertItem';

/** Auction lifecycle kinds the transaction service actually emits to this user. */
const SERVICE_AUCTION_KINDS = new Set(['outbid', 'auction_won', 'auction_ended']);

const WATCH_ALERTS_PAGE_LIMIT = 8;

export function MarketplaceWatchlist() {
  const { entries, isLoading, isSignedIn, watchlistSyncStatus, syncWatchlist } = useMarketplaceWatchlist();
  const alertFeed = useMarketplaceWatchAlertFeed();
  const serviceFeed = useMarketplaceNotificationFeed();
  const [isCheckingNow, setIsCheckingNow] = useState(false);
  // Visiting the watchlist runs the bounded detection pass (spaced; no daemon).
  useMarketplaceWatchDetection();

  const serviceAuctionRows = serviceFeed.items.filter((item) => SERVICE_AUCTION_KINDS.has(item.type)).slice(0, 5);
  const localAlerts = alertFeed.items.slice(0, WATCH_ALERTS_PAGE_LIMIT);
  const auctionNotifications = [
    ...serviceAuctionRows.map((item) => ({ source: 'service' as const, item })),
    ...localAlerts.map((item) => ({ source: 'device' as const, item })),
  ].sort((a, b) => b.item.timestamp - a.item.timestamp);
  const lastCheckedAt = entries.reduce((newest, entry) => Math.max(newest, entry.snapshot?.checked_at ?? 0), 0);

  const checkNow = async () => {
    setIsCheckingNow(true);
    try {
      await CommerceController.runWatchlistDetection();
    } catch (error) {
      Logger.warn('Manual watchlist check failed', { error });
    } finally {
      setIsCheckingNow(false);
    }
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

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
              Watchlist
            </Heading>
            <Typography as="p" className="mt-2 text-muted-foreground">
              {entries.length} watched {entries.length === 1 ? 'item' : 'items'}.
            </Typography>
          </div>
          {isSignedIn && entries.length > 0 && (
            <div className="flex items-center gap-3">
              {lastCheckedAt > 0 && <LastCheckedLabel checkedAt={lastCheckedAt} />}
              <Button
                variant="outline"
                className="rounded-full"
                disabled={isCheckingNow}
                onClick={() => void checkNow()}
                data-cy="watchlist-check-now"
              >
                <RefreshCw className={`size-4 ${isCheckingNow ? 'animate-spin' : ''}`} />
                Check now
              </Button>
            </div>
          )}
        </div>

        {isSignedIn && watchlistSyncStatus === 'unavailable' && (
          <Card className="rounded-md p-0" data-cy="watchlist-sync-unavailable-notice">
            <CardContent className="flex flex-col gap-1 p-6">
              <Typography as="p" className="font-medium">
                Private sync is unavailable right now
              </Typography>
              <Typography as="p" className="text-sm text-muted-foreground">
                Your watchlist keeps working on this device. It syncs encrypted through your homeserver once the
                marketplace can provide your private data key again.
              </Typography>
            </CardContent>
          </Card>
        )}

        {isSignedIn && watchlistSyncStatus === 'unsupported' && (
          <Card className="rounded-md p-0" data-cy="watchlist-sync-unsupported-notice">
            <CardContent className="flex flex-col gap-1 p-6">
              <Typography as="p" className="font-medium">
                This browser cannot sync your watchlist
              </Typography>
              <Typography as="p" className="text-sm text-muted-foreground">
                Your watchlist keeps working on this device. Syncing it across devices needs a browser that can
                coordinate its open tabs, so no change is lost. Update this browser or use a current one to sync.
              </Typography>
            </CardContent>
          </Card>
        )}

        {!isSignedIn ? (
          <Card className="rounded-md p-0">
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <Eye className="size-10 text-muted-foreground" />
              <Heading level={2} size="md">
                Sign in to keep a watchlist
              </Heading>
              <Typography as="p" className="max-w-md text-muted-foreground">
                Watched items are stored for your pubky on this device and synced privately across your devices through
                your homeserver. Alerts come from checks the app runs while you browse.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <>
            {auctionNotifications.length > 0 && (
              <section aria-label="Auction notifications" className="flex flex-col gap-3" data-cy="watchlist-alerts">
                <div className="flex flex-wrap items-center gap-2">
                  <Gavel className="size-4 text-brand" />
                  <Heading level={2} size="sm" className="text-lg">
                    Auction notifications
                  </Heading>
                </div>
                <Card className="rounded-md p-0">
                  <CardContent className="divide-y divide-border p-0">
                    {auctionNotifications.map((row) => (
                      <div key={`${row.source}:${row.item.id}`} className="p-6">
                        {row.source === 'service' ? (
                          <MarketplaceNotificationItem notification={row.item} />
                        ) : (
                          <MarketplaceWatchAlertItem item={row.item} showSourceBadge />
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : entries.length > 0 ? (
              <section aria-label="Watched items" className="flex flex-col gap-3">
                {entries.map((entry) => (
                  <WatchlistItemRow key={entry.listingId} entry={entry} />
                ))}
              </section>
            ) : (
              <MarketplaceEmptyState
                icon={Heart}
                title="Nothing watched yet"
                description="Tap the heart on a listing, or the bell on an auction, to watch it here."
              />
            )}
          </>
        )}
        {isSignedIn &&
          (watchlistSyncStatus === 'needs_reauth' || watchlistSyncStatus === 'needs_marketplace_approval') && (
            <div
              className="flex flex-col items-center gap-4 py-6 text-center"
              data-cy={
                watchlistSyncStatus === 'needs_reauth'
                  ? 'watchlist-sync-reauth-notice'
                  : 'watchlist-sync-marketplace-approval-notice'
              }
            >
              <Typography as="p" className="text-sm text-muted-foreground">
                Have more devices?
              </Typography>
              <MarketplaceReauthDialog
                triggerLabel="Enable device sync"
                intent="sync"
                triggerVariant="outline"
                triggerIcon={RefreshCw}
                refusal={watchlistSyncStatus === 'needs_reauth' ? 'homeserver' : 'purchase_session'}
                onReauthenticated={syncWatchlist}
              />
            </div>
          )}
      </Container>
    </ContentLayout>
  );
}

function LastCheckedLabel({ checkedAt }: { checkedAt: number }) {
  const { formatRelativeTime } = useRelativeTime();
  return (
    <Typography as="span" className="text-xs text-muted-foreground">
      Checked {formatCheckedRelativeTime(formatRelativeTime(new Date(checkedAt)))}
    </Typography>
  );
}

function WatchlistItemRow({ entry }: { entry: MarketplaceWatchlistEntry }) {
  const { item, snapshot, sellerId, rawListingId, listingId } = entry;
  const isAuction = item ? item.saleFormat === 'auction' : snapshot?.auction_ends_at !== null;
  const watch = useCommerceFavorite(listingId);
  const seller = useMarketplaceSellerSummary(sellerId, { includeReputation: false });
  const { ref: liveBidRef, bid } = useMarketplaceLiveBid(sellerId, rawListingId, Boolean(item && isAuction));

  const hasLiveBid = bid !== null && bid.bidCount > 0;
  const title = item?.title ?? snapshot?.title ?? rawListingId;
  const mediaUrl = useMarketplaceFirstMediaUrl(item?.mediaUrls ?? []);
  const endsAt = item?.auction?.endsAt ?? snapshot?.auction_ends_at ?? null;
  const state = deriveWatchlistState(entry);

  return (
    <Card ref={liveBidRef} className="rounded-md p-0" data-cy="watchlist-item">
      <CardContent className="grid gap-4 p-6">
        <MarketplaceProductSummary
          inset
          title={title}
          href={getMarketplaceListingRoute(sellerId, rawListingId)}
          imageUrl={mediaUrl}
          details={seller.displayName}
          priceLabel={isAuction ? (hasLiveBid ? 'Current bid' : 'Starting bid') : undefined}
          price={
            item && (
              <>
                {formatCommerceMoney(hasLiveBid ? bid.currentPrice : item.price)}
                <MarketplaceIndicativePrice
                  money={hasLiveBid ? bid.currentPrice : item.price}
                  className="font-normal"
                />
                {hasLiveBid && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {bid.bidCount} {bid.bidCount === 1 ? 'bid' : 'bids'}
                  </span>
                )}
              </>
            )
          }
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Badge variant="outline">{isAuction ? 'Auction' : 'Buy now'}</Badge>
            {state && (
              <Badge
                variant="outline"
                className={state.tone === 'warn' ? 'border-amber-500/50 text-amber-300' : undefined}
              >
                {state.label}
              </Badge>
            )}
            {endsAt && <EndsAtBadge endsAt={endsAt} />}
            {!item && (
              <Typography as="span" className="text-xs text-muted-foreground">
                Not in the local catalog cache yet. Open the listing or wait for the next check.
              </Typography>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove from watchlist"
            disabled={watch.isMutating}
            onClick={() => void watch.toggle()}
            data-cy="watchlist-item-unwatch"
          >
            {isAuction ? (
              <Bell className="size-4 fill-brand text-brand" />
            ) : (
              <Heart className="size-4 fill-brand text-brand" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EndsAtBadge({ endsAt }: { endsAt: string }) {
  // Captured once per mount: the countdown label reflects when the row
  // rendered, matching the page's visit-triggered freshness model.
  const [nowMs] = useState(() => Date.now());
  const endsMs = Date.parse(endsAt);
  const remaining = endsMs - nowMs;
  if (remaining <= 0) {
    return <Badge variant="outline">Ended</Badge>;
  }
  const label =
    remaining < 48 * 60 * 60 * 1_000
      ? `Ends in ${formatRemaining(remaining)}`
      : `Ends ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(endsMs))}`;
  const isEndingSoon = remaining < 24 * 60 * 60 * 1_000;
  return (
    <Badge variant="outline" className={isEndingSoon ? 'border-amber-500/50 text-amber-300' : undefined}>
      {label}
    </Badge>
  );
}

function formatRemaining(remainingMs: number): string {
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function deriveWatchlistState(entry: MarketplaceWatchlistEntry): { label: string; tone: 'normal' | 'warn' } | null {
  // The projection's sale state (a real per-listing read) wins over the
  // index state when this device has observed one.
  const projectionState = entry.snapshot?.projection_state;
  if (projectionState === 'sold') return { label: 'Sold out', tone: 'warn' };
  if (projectionState === 'reserved') return { label: 'Reserved', tone: 'warn' };

  const endsAt = entry.item?.auction?.endsAt ?? entry.snapshot?.auction_ends_at ?? null;
  const indexState = entry.item?.state ?? entry.snapshot?.index_state ?? null;
  const state = indexState ? effectiveListingState(indexState, endsAt) : null;
  switch (state) {
    case 'active':
      return { label: 'Active', tone: 'normal' };
    case 'paused':
      return { label: 'Unlisted', tone: 'warn' };
    case 'ended':
      return { label: 'Ended', tone: 'warn' };
    case 'removed':
      return { label: 'Removed', tone: 'warn' };
    default:
      return null;
  }
}

function formatCheckedRelativeTime(relativeTime: string): string {
  if (relativeTime === '0s') return 'just now';

  const seconds = relativeTime.match(/^(\d+)s$/);
  if (seconds) return `${seconds[1]} sec ago`;

  return relativeTime.endsWith('ago') ? relativeTime : `${relativeTime} ago`;
}
