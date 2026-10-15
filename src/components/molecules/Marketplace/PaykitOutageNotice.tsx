'use client';

import { LoaderCircle } from 'lucide-react';
import { Typography } from '@/atoms/Typography/Typography';
import { PAYKIT_OUTAGE_COPY } from '@/libs/commerce/paykit-rail';

/**
 * The calm state for a Paykit outage: it says what is happening, that nothing
 * the user set up changed, and that the page recovers on its own. It carries
 * no action because nothing is needed from the user.
 */
export function PaykitOutageNotice({
  audience,
  surface,
  id,
  className,
}: {
  audience: 'seller' | 'buyer';
  surface: string;
  id?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      id={id}
      tabIndex={-1}
      aria-live="polite"
      data-surface={surface}
      className={className ?? 'flex items-start gap-3 rounded-md bg-brand/5 p-4'}
    >
      <LoaderCircle
        className="mt-0.5 size-5 shrink-0 animate-spin text-brand motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div>
        <Typography as="p" className="font-semibold">
          {PAYKIT_OUTAGE_COPY.title}
        </Typography>
        <Typography as="p" className="text-sm text-muted-foreground">
          {audience === 'seller' ? PAYKIT_OUTAGE_COPY.sellerBody : PAYKIT_OUTAGE_COPY.buyerBody}
        </Typography>
      </div>
    </div>
  );
}
