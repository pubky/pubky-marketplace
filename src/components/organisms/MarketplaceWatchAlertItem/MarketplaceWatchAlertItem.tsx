'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Gavel, type LucideIcon, Tag, Timer } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { useRelativeTime } from '@/hooks/useRelativeTime/useRelativeTime';
import { cn } from '@/libs/utils/utils';
import { RelativeTimestamp } from '@/molecules/RelativeTimestamp/RelativeTimestamp';
import type { MarketplaceWatchAlertFeedItem } from '@/pipes/marketplaceWatch/marketplaceWatchAlert.types';
import { getWatchAlertDetail, getWatchAlertHeadline } from './MarketplaceWatchAlertItem.utils';

/** Same dimensions as the social NotificationIcon so mixed rows align. */
const ICON_SIZE = 24;
const BADGE_SIZE = 11;

interface MarketplaceWatchAlertItemProps {
  item: MarketplaceWatchAlertFeedItem;
  isMobile?: boolean;
  showSourceBadge?: boolean;
}

/**
 * A device-local watch alert row inside the general notification list.
 * Deliberately NOT dressed as a server event: there is no actor (nobody sent
 * this), the leading mark is a watchlist icon instead of an avatar, and the
 * row identifies device detection with either a label or its secondary copy.
 */
export function MarketplaceWatchAlertItem({
  item,
  isMobile = false,
  showSourceBadge = false,
}: MarketplaceWatchAlertItemProps) {
  const router = useRouter();
  const { formatRelativeTime } = useRelativeTime();
  const timestampDate = new Date(item.timestamp);
  const detail = getWatchAlertDetail(item);

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    router.push(item.href);
  };

  return (
    <Container
      overrideDefaults={true}
      className={cn(
        'w-full min-w-0 cursor-pointer items-center gap-2',
        showSourceBadge
          ? 'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto]'
          : 'flex justify-between',
      )}
      onClick={handleRowClick}
      data-cy="marketplace-watch-alert-item"
    >
      <Container overrideDefaults={true} className="flex min-w-0 flex-1 items-center gap-2">
        <Container
          overrideDefaults={true}
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand lg:size-8"
        >
          <Eye className="size-4" />
        </Container>

        <Container overrideDefaults={true} className="min-w-0 flex-1">
          <Typography
            as="p"
            className={cn(
              'min-w-0 text-sm leading-normal font-medium text-foreground lg:text-base',
              showSourceBadge ? 'break-words' : 'truncate',
            )}
          >
            <Link href={item.href} className="text-foreground hover:underline">
              {getWatchAlertHeadline(item)}: {item.title}
            </Link>
          </Typography>
          {(detail || !showSourceBadge) && (
            <Typography
              as="p"
              className={cn('text-xs text-muted-foreground', showSourceBadge ? 'break-words' : 'truncate')}
            >
              {showSourceBadge ? detail : `${detail ? `${detail} · ` : ''}Watchlist · checked on this device`}
            </Typography>
          )}
        </Container>
      </Container>

      {showSourceBadge && (
        <Badge
          variant="outline"
          className="col-start-1 row-start-2 ml-8 w-fit sm:col-start-2 sm:row-start-1 sm:mr-2 sm:ml-0"
        >
          Detected by device
        </Badge>
      )}
      <Link
        href={item.href}
        className={cn(
          'flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80',
          showSourceBadge && 'col-start-2 row-start-1 sm:col-start-3',
        )}
      >
        <RelativeTimestamp
          timeAgo={formatRelativeTime(timestampDate)}
          date={timestampDate}
          isMobile={isMobile}
          className="text-xs font-medium tracking-widest text-muted-foreground"
        />
        <Container
          overrideDefaults={true}
          className="relative shrink-0"
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
        >
          <WatchAlertKindIcon kind={item.kind} />
          {item.isUnseen && (
            <Container
              data-cy="notification-unread-dot"
              overrideDefaults={true}
              className="absolute right-0 bottom-0 rounded-full bg-brand"
              style={{ width: BADGE_SIZE, height: BADGE_SIZE }}
            />
          )}
        </Container>
      </Link>
    </Container>
  );
}

function WatchAlertKindIcon({ kind }: { kind: MarketplaceWatchAlertFeedItem['kind'] }) {
  const Icon: LucideIcon = kind === 'ending_soon' ? Timer : kind === 'new_bid' || kind === 'outbid' ? Gavel : Tag;
  return <Icon className="text-foreground" size={ICON_SIZE} />;
}
