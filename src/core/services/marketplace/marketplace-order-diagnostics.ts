import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { MarketplaceOrderParseError } from './marketplace-projections';

export const MARKETPLACE_ORDER_DIAGNOSTIC_MAX_SETS = 32;
const reportedOrderParseErrorSets = new Set<string>();

export function reportMarketplaceOrderParseErrors(errors: readonly MarketplaceOrderParseError[]): void {
  if (errors.length === 0) return;

  const invalidOrders = errors.map((entry) => ({
    index: entry.index,
    orderId: entry.orderId,
    issues: entry.issues.map((issue) => `${issue.path}: ${issue.message}`),
  }));
  const key = invalidOrders
    .map((entry) => `${entry.orderId ?? `<index:${entry.index}>`}:${entry.issues.join('|')}`)
    .sort()
    .join('\u0000');

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
      invalidOrders,
    },
  });
}

export function resetMarketplaceOrderDiagnostics(): void {
  reportedOrderParseErrorSets.clear();
}
