'use client';

import { ShieldAlert } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import type { PendingDeliveryKeyChange } from '@/hooks/useDeliveryKeyGate/useDeliveryKeyGate';
import { formatDeliveryKeyFingerprint } from '@/libs/commerce/delivery-envelope';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { truncateMiddle } from '@/libs/utils/utils';

export type MarketplaceDeliveryKeyChangeDialogProps = {
  change: PendingDeliveryKeyChange | null;
  onDecision: (accepted: boolean) => void;
};

/** The buyer's confirmation when a seller's delivery key differs from the one pinned earlier. */
export function MarketplaceDeliveryKeyChangeDialog({ change, onDecision }: MarketplaceDeliveryKeyChangeDialogProps) {
  return (
    <Dialog open={change !== null} onOpenChange={(open) => !open && onDecision(false)}>
      <DialogContent className="w-xl" hiddenTitle={DELIVERY_KEY_COPY.changedTitle}>
        <DialogHeader>
          <DialogTitle>{DELIVERY_KEY_COPY.changedTitle}</DialogTitle>
        </DialogHeader>
        {change ? (
          <div className="flex flex-col gap-3" data-testid="delivery-key-change">
            <Typography className="text-base text-white/80">{DELIVERY_KEY_COPY.changedBody}</Typography>
            <Typography className="text-sm text-white/60">Seller {truncateMiddle(change.sellerPubky, 20)}</Typography>
            <div className="flex flex-col gap-1">
              <Typography className="text-sm text-white/60">Key you saw before</Typography>
              <Typography className="font-mono text-sm break-all">
                {formatDeliveryKeyFingerprint(change.pinnedKeyId)}
              </Typography>
              <Typography className="text-sm text-white/60">Key the seller publishes now</Typography>
              <Typography className="font-mono text-sm break-all">
                {formatDeliveryKeyFingerprint(change.currentKeyId)}
              </Typography>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button size="lg" onClick={() => onDecision(true)}>
            <ShieldAlert className="h-4 w-4" />
            Use the new key
          </Button>
          <Button variant="outline" size="lg" onClick={() => onDecision(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
