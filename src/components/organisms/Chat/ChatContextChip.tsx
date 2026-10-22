'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { Package, ReceiptText } from 'lucide-react';
import { getMarketplaceListingRoute } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { getCommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { getMarketplaceOrderRoute } from '@/libs/commerce/activity-links';
import { Logger } from '@/libs/logger/logger';
import { cn } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * What a message is about: the listing (title, linked) or the order (linked
 * to its card). The listing is looked up on the peer first (buyer→seller),
 * then on the viewer (seller→buyer).
 */
export function ChatContextChip({
  context,
  peerPubky,
  className,
}: {
  context: ChatContext | null | undefined;
  peerPubky: string;
  className?: string;
}) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const listingId = context?.listingId ?? null;
  const listing = useLiveQuery(async () => {
    if (!listingId) return null;
    for (const owner of [peerPubky, currentUserPubky]) {
      if (!owner) continue;
      try {
        const found = await CommerceController.getOrFetchListing(owner, listingId);
        if (found) return { owner, title: found.title };
      } catch (error) {
        Logger.debug('Chat context listing lookup failed', { error });
      }
    }
    return null;
  }, [listingId, peerPubky, currentUserPubky]);

  if (!context?.listingId && !context?.orderId) return null;
  // Without commerce the listing and order pages lead nowhere: the chips still say what the chat is about,
  // as plain labels.
  const linked = getCommerceAdapterMode() !== 'unavailable';
  const chip =
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-brand/20 [&_svg]:text-brand';
  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid="chat-context-chip">
      {context.listingId ? (
        listing && linked ? (
          <Link href={getMarketplaceListingRoute(listing.owner, context.listingId)} overrideDefaults className={chip}>
            <Package className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography as="span" size="xs" className="truncate" overrideDefaults>
              {listing.title}
            </Typography>
          </Link>
        ) : listing ? (
          <span className={chip}>
            <Package className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography as="span" size="xs" className="truncate" overrideDefaults>
              {listing.title}
            </Typography>
          </span>
        ) : (
          <span className={chip}>
            <Package className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography as="span" size="xs" overrideDefaults>
              Listing
            </Typography>
          </span>
        )
      ) : null}
      {context.orderId ? (
        linked ? (
          <Link href={getMarketplaceOrderRoute(context.orderId)} overrideDefaults className={chip}>
            <ReceiptText className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography as="span" size="xs" overrideDefaults>
              Order {context.orderId.slice(0, 8)}
            </Typography>
          </Link>
        ) : (
          <span className={chip}>
            <ReceiptText className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography as="span" size="xs" overrideDefaults>
              Order {context.orderId.slice(0, 8)}
            </Typography>
          </span>
        )
      ) : null}
    </div>
  );
}
