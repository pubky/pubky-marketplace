'use client';

import { Truck } from 'lucide-react';
import { Typography } from '@/atoms/Typography/Typography';
import type { DeliveryKeyBlock } from '@/hooks/useDeliveryKeyGate/useDeliveryKeyGate';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { truncateMiddle } from '@/libs/utils/utils';

/**
 * Why Pay stopped at a seller's delivery key. It stays on screen until the
 * buyer presses Pay again, so a seller who has not finished delivery setup
 * never reads as a Pay button that does nothing.
 */
export function DeliveryKeyBlockedNotice({ block }: { block: DeliveryKeyBlock | null }) {
  if (!block) return null;
  return (
    <div
      role="alert"
      data-surface="delivery-key-blocked"
      data-testid="delivery-key-blocked"
      className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <Truck className="mt-0.5 size-5 shrink-0 text-warning-foreground" aria-hidden="true" />
      <div className="grid gap-1">
        <Typography as="p" className="text-sm font-semibold">
          {DELIVERY_KEY_COPY.blockedTitle}
        </Typography>
        <Typography as="p" className="text-sm text-muted-foreground">
          {block.message}
        </Typography>
        {block.sellerPubky && (
          <Typography as="p" className="text-xs text-muted-foreground" data-testid="delivery-key-blocked-seller">
            Seller {truncateMiddle(block.sellerPubky, 20)}
          </Typography>
        )}
      </div>
    </div>
  );
}
