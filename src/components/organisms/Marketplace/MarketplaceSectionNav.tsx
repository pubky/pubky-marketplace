'use client';

import { usePathname } from 'next/navigation';
import {
  Bell,
  Hand,
  HandCoins,
  Heart,
  MessageCircle,
  Package,
  ReceiptText,
  Settings,
  ShoppingCart,
  Store,
} from 'lucide-react';
import { APP_ROUTES, MARKETPLACE_ROUTES } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { isSocialLinkOutEnabled } from '@/config/social';
import { useChatUnread } from '@/hooks/useChatUnread/useChatUnread';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { useMarketplaceActivityUnread } from '@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread';
import { useMarketplaceCartCount } from '@/hooks/useMarketplaceCartCount/useMarketplaceCartCount';
import { useMarketplaceNavSwipeHint } from '@/hooks/useMarketplaceNavSwipeHint/useMarketplaceNavSwipeHint';
import { useMarketplaceOrdersAttention } from '@/hooks/useMarketplaceOrdersAttention/useMarketplaceOrdersAttention';
import { cn } from '@/libs/utils/utils';

type MarketplaceSectionItem = {
  label: string;
  href: string;
  icon: typeof MessageCircle;
  badge?: 'cart' | 'activity' | 'orders' | 'messages';
  activePrefixes?: readonly string[];
};

const getItems = (socialLinkOut: boolean): readonly MarketplaceSectionItem[] => [
  {
    label: 'Market',
    href: APP_ROUTES.MARKETPLACE,
    icon: Store,
    activePrefixes: [
      APP_ROUTES.MARKETPLACE,
      MARKETPLACE_ROUTES.LISTING,
      MARKETPLACE_ROUTES.DROP,
      MARKETPLACE_ROUTES.DROPS,
    ],
  },
  { label: 'Messages', href: APP_ROUTES.MESSAGES, icon: MessageCircle, badge: 'messages' },
  { label: 'Watchlist', href: MARKETPLACE_ROUTES.WATCHLIST, icon: Heart },
  {
    label: 'Cart',
    href: MARKETPLACE_ROUTES.CART,
    icon: ShoppingCart,
    badge: 'cart',
    activePrefixes: [MARKETPLACE_ROUTES.CART, MARKETPLACE_ROUTES.CHECKOUT, MARKETPLACE_ROUTES.AWARD_CHECKOUT],
  },
  { label: 'Offers', href: MARKETPLACE_ROUTES.OFFERS, icon: HandCoins },
  { label: 'Orders', href: MARKETPLACE_ROUTES.ORDERS, icon: ReceiptText, badge: 'orders' },
  { label: 'Activity', href: MARKETPLACE_ROUTES.NOTIFICATIONS, icon: Bell, badge: 'activity' },
  {
    label: 'My shop',
    href: MARKETPLACE_ROUTES.DASHBOARD,
    icon: Package,
    activePrefixes: [
      MARKETPLACE_ROUTES.DASHBOARD,
      MARKETPLACE_ROUTES.SELL,
      MARKETPLACE_ROUTES.MY_SHOP,
      ...(!socialLinkOut ? [MARKETPLACE_ROUTES.SETTINGS] : []),
    ],
  },
  ...(socialLinkOut ? [{ label: 'Shop settings', href: MARKETPLACE_ROUTES.SETTINGS, icon: Settings }] : []),
];

export function MarketplaceSectionNav({
  onNavigate,
  className,
}: {
  onNavigate?: (href: string) => void;
  className?: string;
}) {
  const pathname = usePathname();
  const socialLinkOut = isSocialLinkOutEnabled();
  const isEmbedded = useIsEmbedded();
  const cartCount = useMarketplaceCartCount();
  // The global navigation carries the unread count when it is shown; with
  // link-out, and in the embedded Shop (no Shop header), this bar is the only place.
  const messagesCount = useChatUnread({ enabled: socialLinkOut || isEmbedded });
  const activityUnreadCount = useMarketplaceActivityUnread();
  const ordersAttentionCount = useMarketplaceOrdersAttention();
  const { scrollRef, onScroll, onInteract, showSwipeHint } = useMarketplaceNavSwipeHint(pathname);

  return (
    <div
      className={cn(
        'sticky top-(--marketplace-subnav-top) z-(--z-sticky-subnav) mb-6 w-full min-w-0 bg-background',
        "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background/80 after:to-transparent after:content-['']",
        className,
      )}
      data-surface="marketplace-section-nav"
    >
      <nav
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onInteract}
        onWheel={onInteract}
        onKeyDown={onInteract}
        aria-label="Market sections"
        data-testid="marketplace-section-nav"
        className="w-full min-w-0 overflow-x-auto sm:overflow-visible"
      >
        <div className="flex w-full min-w-max flex-nowrap sm:min-w-0 sm:flex-wrap">
          {getItems(socialLinkOut).map(({ label, href, icon: Icon, badge, activePrefixes }) => {
            const prefixes = activePrefixes ?? [href];
            const active =
              typeof pathname === 'string' &&
              prefixes.some(
                (prefix) =>
                  pathname === prefix || (prefix !== APP_ROUTES.MARKETPLACE && pathname.startsWith(`${prefix}/`)),
              );
            const count =
              badge === 'cart'
                ? cartCount
                : badge === 'activity'
                  ? activityUnreadCount
                  : badge === 'orders'
                    ? ordersAttentionCount
                    : badge === 'messages'
                      ? messagesCount
                      : 0;
            const badgeNoun =
              badge === 'cart'
                ? 'cart items'
                : badge === 'orders'
                  ? 'orders needing you'
                  : badge === 'messages'
                    ? 'unread messages'
                    : 'activity needing you';
            return (
              <Link
                key={label}
                href={href}
                prefetch={false}
                overrideDefaults
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  if (onNavigate) {
                    event.preventDefault();
                    onNavigate(href);
                  }
                }}
                className={cn(
                  'relative inline-flex min-h-12 flex-1 shrink-0 items-center justify-center gap-2 border-b px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:text-white',
                  active ? 'border-white text-white' : 'border-border text-muted-foreground',
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className={cn(!active && 'sr-only sm:not-sr-only')}>{label}</span>
                {count > 0 && (
                  <Badge
                    data-testid={`marketplace-section-nav-${badge}-badge`}
                    aria-label={`${count} ${badgeNoun}`}
                    className="h-5 min-w-5 rounded-full bg-brand px-1.5 shadow-sm"
                    variant="secondary"
                  >
                    <Typography
                      className={cn('font-semibold text-primary-foreground', count > 21 && 'text-xs')}
                      size="xs"
                    >
                      {count > 21 ? '21+' : count}
                    </Typography>
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      {showSwipeHint && (
        <span
          aria-hidden="true"
          data-testid="marketplace-nav-swipe-hint"
          className="marketplace-nav-swipe-hint pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-linear-to-l from-background via-background/90 to-transparent pr-1 text-brand motion-reduce:hidden sm:hidden"
        >
          <Hand className="size-6 fill-brand/15" />
        </span>
      )}
    </div>
  );
}
