'use client';

import { useState } from 'react';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import { formatOrderInstant } from '@/libs/commerce/checkout-hold';
import { formatCommerceMoney } from '@/libs/commerce/format';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

type ReturnState = NonNullable<MarketplaceOrder['returnRequest']>['state'];

export const RETURN_STATUS_COPY = {
  title: 'Return',
  chip: {
    requested: 'Return requested',
    approved: 'Return approved',
    received: 'Return received',
    refunded: 'Refunded',
  } satisfies Record<ReturnState, string>,
  buyerNext: {
    requested: 'Waiting for the seller to approve your return. You can cancel it until they do.',
    approved: 'Send the item back to the seller. They record your refund once it arrives.',
    received: 'The seller has the item back. Your refund comes next.',
    refunded: 'The seller recorded your refund.',
  } satisfies Record<ReturnState, string>,
  sellerNext: {
    requested: 'Approve the return so the buyer can send the item back.',
    approved: 'Mark the return received when the item arrives, then refund the buyer.',
    received: 'Refund the buyer and record it here.',
    refunded: 'You recorded the refund.',
  } satisfies Record<ReturnState, string>,
  cancel: 'Cancel return',
  cancelling: 'Cancelling…',
} as const;

/**
 * The return on an order: its status, what happens next and for whom, the
 * amount and reason, and Cancel return for the buyer until the seller acts
 * (`return.cancel`). The service sets no deadline for the seller's answer, so
 * none is shown.
 */
export function MarketplaceReturnStatus({
  order,
  isBuyer,
  actOnOrder,
}: {
  order: MarketplaceOrder;
  isBuyer: boolean;
  actOnOrder: (order: MarketplaceOrder, kind: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const request = order.returnRequest;
  if (!request) return null;
  const amount = formatCommerceMoney({ ...order.total, amountMinor: request.requestedAmountMinor });
  const requestedAt = formatOrderInstant(request.requestedAt);
  const canCancel = isBuyer && order.state === 'return_requested' && request.state === 'requested';

  const cancel = async () => {
    setCancelling(true);
    try {
      await actOnOrder(order, 'return.cancel', {});
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section
      className="mt-3 grid gap-2 rounded-md border border-border/60 bg-card/50 p-4"
      aria-label={RETURN_STATUS_COPY.title}
      data-testid="order-return-status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={3} size="sm" className="text-base font-semibold">
          {RETURN_STATUS_COPY.title}
        </Heading>
        <Badge variant="outline" data-testid="order-return-chip">
          {RETURN_STATUS_COPY.chip[request.state]}
        </Badge>
      </div>
      <Typography as="p" className="text-sm text-foreground" data-testid="order-return-next">
        {(isBuyer ? RETURN_STATUS_COPY.buyerNext : RETURN_STATUS_COPY.sellerNext)[request.state]}
      </Typography>
      <Typography as="p" className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
        {amount} · {request.reason}
      </Typography>
      {requestedAt && (
        <Typography as="p" className="text-xs text-muted-foreground">
          Requested {requestedAt}
        </Typography>
      )}
      {canCancel && (
        <Button
          size="default"
          variant="secondary"
          className="justify-self-start rounded-full"
          disabled={cancelling}
          onClick={() => void cancel()}
        >
          {cancelling ? RETURN_STATUS_COPY.cancelling : RETURN_STATUS_COPY.cancel}
        </Button>
      )}
    </section>
  );
}
