import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import {
  DERIVED_HOLD_EXPIRES_AT,
  DERIVED_PAYING_ORDER_CHANGED_PATHS,
  DERIVED_PAYING_ORDER_ID,
  DERIVED_PAYING_SOURCE_ORDER_ID,
  MALFORMED_ORDER_CHANGED_PATHS,
  MALFORMED_ORDER_ID,
  MALFORMED_ORDER_SOURCE_ID,
  MALFORMED_REVIEW_REASON,
  STAGING_ORDERS_BUYER_PUBKY,
  stagingCheckoutPayingResponse,
  stagingOrdersResponse,
  stagingOrdersWithMalformedResponse,
  UPSTREAM_INCONSISTENT_ORDER_ID,
} from '@/test/fixtures/marketplace/orders-staging-2026-11-26';
import { MarketplaceGatewayService } from './marketplace';
import { resetMarketplaceOrderDiagnostics } from './marketplace-order-diagnostics';
import { MarketplaceSessionService } from './marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from './marketplace-session-grant';

const SESSION_TOKEN = 'A'.repeat(43);

const config = vi.hoisted(() => ({
  mode: 'transaction-service' as string,
}));

vi.mock('@/services/homeserver/homeserver', () => ({ HomeserverService: {} }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => config.mode,
    getMarketplaceUrl: () => 'http://127.0.0.1:8080',
  };
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [prefix];
    const changes: string[] = [];
    for (let index = 0; index < before.length; index += 1) {
      changes.push(...changedPaths(before[index], after[index], `${prefix}[${index}]`));
    }
    return changes;
  }
  if (!isRecord(before) || !isRecord(after)) return [prefix];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    changes.push(...changedPaths(before[key], after[key], path));
  }
  return changes;
}

function establishSession(): void {
  MarketplaceSessionService.establishClaimedGrantSession(
    {
      token: SESSION_TOKEN,
      pubky: STAGING_ORDERS_BUYER_PUBKY,
      capabilities: MARKETPLACE_SESSION_GRANT,
      expiresAt: '2027-01-02T12:00:00.000Z',
    },
    STAGING_ORDERS_BUYER_PUBKY,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('staging orders captured on 2026-11-26', () => {
  beforeEach(() => {
    config.mode = 'transaction-service';
    MarketplaceSessionService.clearSession();
    resetMarketplaceOrderDiagnostics();
    vi.mocked(fetch).mockReset();
  });

  it('parses all seven captured orders through the durable /v1/orders client, including upstream_inconsistent', async () => {
    establishSession();
    const body = stagingOrdersResponse();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    // CommerceApplication.getMarketplaceOrderList, which Orders and Checkout load
    // through CommerceController.getMarketplaceOrderList, delegates here.
    const result = await MarketplaceGatewayService.getOrderList(STAGING_ORDERS_BUYER_PUBKY);

    expect(result.parseErrors).toEqual([]);
    expect(result.orders.map((order) => order.id)).toEqual(body.orders.map((order) => order.id));
    expect(result.orders).toHaveLength(7);
    expect(result.orders.find((order) => order.id === UPSTREAM_INCONSISTENT_ORDER_ID)).toMatchObject({
      id: UPSTREAM_INCONSISTENT_ORDER_ID,
      state: 'cancelled',
      payment: { state: 'manual_review', reviewReason: 'upstream_inconsistent' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/orders',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      }),
    );
  });

  it('keeps 470c02d8 exact when a derived copy of 06cc87e9 is an active payment', async () => {
    establishSession();
    const captured = stagingOrdersResponse();
    const body = stagingCheckoutPayingResponse();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const result = await MarketplaceGatewayService.getOrderList(STAGING_ORDERS_BUYER_PUBKY);
    const source = captured.orders.find((order) => order.id === DERIVED_PAYING_SOURCE_ORDER_ID);
    const derivedWire = body.orders.find((order) => order.id === DERIVED_PAYING_ORDER_ID);
    const derived = result.orders.find((order) => order.id === DERIVED_PAYING_ORDER_ID);
    const upstream = result.orders.find((order) => order.id === UPSTREAM_INCONSISTENT_ORDER_ID);

    expect(changedPaths(source, derivedWire)).toEqual([...DERIVED_PAYING_ORDER_CHANGED_PATHS]);
    expect(result.parseErrors).toEqual([]);
    expect(result.orders).toHaveLength(8);
    expect(derived).toMatchObject({
      id: DERIVED_PAYING_ORDER_ID,
      state: 'pending_payment',
      holdExpiresAt: DERIVED_HOLD_EXPIRES_AT,
      paykitRequestState: 'pending',
      payment: { state: 'awaiting_entitlement', orderId: DERIVED_PAYING_ORDER_ID },
    });
    expect(upstream).toMatchObject({
      payment: { reviewReason: 'upstream_inconsistent' },
    });
    expect(result.orders.find((order) => order.id === DERIVED_PAYING_SOURCE_ORDER_ID)?.state).toBe('cancelled');
  });

  it('isolates one deliberately malformed order and still returns the seven captured orders', async () => {
    establishSession();
    const captured = stagingOrdersResponse();
    const body = stagingOrdersWithMalformedResponse();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));
    const loggerError = vi.spyOn(Logger, 'error');
    const source = captured.orders.find((order) => order.id === MALFORMED_ORDER_SOURCE_ID);
    const malformedWire = body.orders.find((order) => order.id === MALFORMED_ORDER_ID);

    const result = await MarketplaceGatewayService.getOrderList(STAGING_ORDERS_BUYER_PUBKY);

    expect(changedPaths(source, malformedWire)).toEqual([...MALFORMED_ORDER_CHANGED_PATHS]);
    expect(malformedWire?.payment.review_reason).toBe(MALFORMED_REVIEW_REASON);
    expect(result.orders.map((order) => order.id)).toEqual(captured.orders.map((order) => order.id));
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        kind: 'parse_error',
        orderId: MALFORMED_ORDER_ID,
        issues: [
          expect.objectContaining({
            path: 'orders[7].payment.reviewReason',
            message: expect.stringContaining(`invalid value "${MALFORMED_REVIEW_REASON}"`),
          }),
        ],
      }),
    ]);
    expect(loggerError).toHaveBeenCalledOnce();
    loggerError.mockRestore();
  });
});
