import { Typography } from '@/atoms/Typography/Typography';
import { COMMERCE_BLOCKED_INFO_LABEL } from '@/libs/commerce/region-modes';
import { cn } from '@/libs/utils/utils';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';

/**
 * The one line that replaces Buy, Offer, Bid, Add to cart and Pay in a blocked region, with an info
 * icon for the why. The Market stays open to browse; only the actions are replaced.
 */
export function CommerceBlockedNotice({
  message,
  info,
  testId,
  className,
}: {
  message: string;
  info: string;
  testId: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex items-center gap-2 rounded-md border bg-card/40 px-4 py-3', className)}
      data-testid={testId}
    >
      <Typography as="p" className="text-sm font-medium">
        {message}
      </Typography>
      <InfoHint label={COMMERCE_BLOCKED_INFO_LABEL}>{info}</InfoHint>
    </div>
  );
}
