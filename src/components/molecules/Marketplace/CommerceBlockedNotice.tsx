'use client';

import type { ReactNode } from 'react';
import { Typography } from '@/atoms/Typography/Typography';
import type { CommerceBlockSource } from '@/libs/commerce/commerce-availability';
import { COMMERCE_BLOCKED_INFO_LABEL } from '@/libs/commerce/region-modes';
import { cn } from '@/libs/utils/utils';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';
import { DeclaredCountryChange } from './DeclaredCountryChange';

/**
 * The one line that replaces Buy, Offer, Bid, Add to cart and Pay in a blocked region, with an info
 * icon for the why. The Market stays open to browse; only the actions are replaced. When the country
 * the buyer saved on this device is the reason (`source` is `declared`), it also shows that country
 * with a way to change or clear it, so a saved country is never a dead end.
 */
export function CommerceBlockedNotice({
  message,
  info,
  testId,
  className,
  source = null,
  children,
}: {
  message: string;
  info: string;
  testId: string;
  className?: string;
  source?: CommerceBlockSource | null;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-card/40 px-4 py-3', className)}
      data-testid={testId}
    >
      <Typography as="p" className="text-sm font-medium">
        {message}
      </Typography>
      <InfoHint label={COMMERCE_BLOCKED_INFO_LABEL}>{info}</InfoHint>
      {source === 'declared' && <DeclaredCountryChange testId={`${testId}-country`} />}
      {children}
    </div>
  );
}
