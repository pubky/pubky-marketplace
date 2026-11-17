import { AlertTriangle } from 'lucide-react';
import { Typography } from '@/atoms/Typography/Typography';

/**
 * Why this buyer cannot buy here (the EU and UK fence, a seller at the annual limit, digital items),
 * in the error treatment so it cannot be missed. It sits next to the Buy or Pay button.
 */
export function RegionRefusal({ message, testId }: { message: string; testId: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/60 bg-destructive/15 px-4 py-3"
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <Typography as="p" className="text-sm font-medium">
        {message}
      </Typography>
    </div>
  );
}
