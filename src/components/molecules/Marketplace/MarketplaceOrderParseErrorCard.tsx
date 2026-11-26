'use client';

import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Typography } from '@/atoms/Typography/Typography';
import { orderAnchorId } from '@/libs/commerce/activity-links';
import type { MarketplaceOrderParseError } from '@/services/marketplace/marketplace';

/**
 * Inline diagnostic card rendered when one entry in `/v1/orders` fails schema
 * validation, so valid orders stay visible and the bad record can be diagnosed
 * quickly from its id and Zod issue path(s).
 */
export function MarketplaceOrderParseErrorCard({ error }: { error: MarketplaceOrderParseError }) {
  return (
    <Card
      id={error.orderId ? orderAnchorId(error.orderId) : undefined}
      role="alert"
      className="scroll-mt-24 rounded-md border border-destructive/40 bg-destructive/5 p-0"
      data-testid="marketplace-order-parse-error"
    >
      <CardContent className="grid min-w-0 gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <Typography as="p" className="font-semibold">
            Order could not be displayed
          </Typography>
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            Parse error
          </Badge>
        </div>
        <Typography as="p" className="text-sm text-muted-foreground">
          {error.orderId ? (
            <>
              Order <code className="font-mono text-xs break-all text-foreground">{error.orderId}</code> returned data
              this app could not read.
            </>
          ) : (
            <>Order entry #{error.index + 1} returned data this app could not read.</>
          )}
        </Typography>
        <ul className="grid gap-1 font-mono text-xs break-words text-destructive">
          {error.issues.map((issue, issueIndex) => (
            <li key={`${issue.path}:${issueIndex}`}>
              {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
