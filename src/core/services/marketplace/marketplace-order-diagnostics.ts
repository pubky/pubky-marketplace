import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';

export interface MarketplaceOrderDiagnostic {
  orderId: string | null;
  issues: string[];
}

const MARKETPLACE_ORDER_DIAGNOSTIC_MAX_SETS = 32;
const reportedOrderParseErrorSets = new Set<string>();

export function reportMarketplaceOrderParseErrors(errors: readonly MarketplaceOrderDiagnostic[]): void {
  if (errors.length === 0) return;

  // IDs distinguish local occurrences of the same schema error. Only the
  // row-relative field paths and Zod codes may leave the participant's browser.
  const key = errors
    .map(({ orderId, issues }) => JSON.stringify([orderId, issues]))
    .sort()
    .join('\n');

  if (
    reportedOrderParseErrorSets.has(key) ||
    reportedOrderParseErrorSets.size >= MARKETPLACE_ORDER_DIAGNOSTIC_MAX_SETS
  ) {
    return;
  }
  reportedOrderParseErrorSets.add(key);

  Err.server(ServerErrorCode.INVALID_RESPONSE, 'Marketplace order list had unparseable entries.', {
    service: ErrorService.Marketplace,
    operation: 'getOrders',
    context: {
      invalidOrderCount: errors.length,
      parseIssues: [...new Set(errors.flatMap((entry) => entry.issues))],
    },
  });
}

export function resetMarketplaceOrderDiagnostics(): void {
  reportedOrderParseErrorSets.clear();
}
