import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { useMarketplaceOrders } from '@/hooks/useMarketplaceOrders/useMarketplaceOrders';
import { toast } from '@/molecules/Toaster/use-toast';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { createOrderFixture, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { useMarketplaceOrderAction } from './useMarketplaceOrderAction';
import { ORDER_COMMAND_UNSENDABLE_COPY } from './useMarketplaceOrderAction.types';

// Not a transactional mode, so the orders hook loads nothing: the test drives
// only the command path, from the dialog's hook through the real
// `actOnOrder` envelope, `CommerceController` and the command normalizer.
vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => 'unavailable' };
});

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const usd = (cents: number) => ({ amountMinor: cents, currency: 'USD', exponent: 2 });
const sat = (sats: number) => ({ amountMinor: sats, currency: 'SAT', exponent: 0 });

/** A 2.50 USD PayPal order the seller refunds outside PayPal. */
const paypalOrder = (overrides: Partial<MarketplaceOrder> = {}) =>
  createOrderFixture('return_received', {
    paymentMethod: 'paypal',
    subtotal: usd(250),
    shipping: usd(0),
    total: usd(250),
    ...overrides,
  });

/** 137.00 USD paid through a Paykit request for 51,637 sats. */
const bitcoinOrder = createOrderFixture('cancelled', {
  paymentMethod: 'paykit',
  paymentAsset: null,
  paykitTotalSats: 51_637,
  bitcoinPayable: sat(51_637),
  refundCap: { amountMinor: 51_637, unit: 'sat', exponent: 0 },
});

function renderRefund(order: MarketplaceOrder) {
  return renderHook(() => {
    const { actOnOrder } = useMarketplaceOrders();
    const action = useMarketplaceOrderAction(order, actOnOrder);
    // Read while rendering, as the dialog does, so the form reports it.
    return { ...action, rootError: action.form.formState.errors.root?.message };
  });
}

describe('useMarketplaceOrderAction refund through the Shop command contract', () => {
  let execute: MockInstance<typeof CommerceApplication.executeMarketplaceCommand>;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });
    useCommerceStore.getState().reset();
    execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue({
      ok: true,
      version: 1,
      commandId: '00000000-0000-4000-8000-000000000901',
      aggregateId: 'order:00000000-0000-4000-8000-000000000902',
      revision: 9,
      eventIds: [],
      result: { kind: 'order' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'a partial PayPal refund with an order-unit cap',
      paypalOrder({ refundCap: { amountMinor: 250, unit: 'order', exponent: 2 } }),
      '1.00',
      100,
      'order',
    ],
    [
      'a full PayPal refund with an order-unit cap',
      paypalOrder({ refundCap: { amountMinor: 250, unit: 'order', exponent: 2 } }),
      '2.00',
      200,
      'order',
    ],
    ['a Bitcoin refund with a sats cap', bitcoinOrder, '51637', 51_637, 'sat'],
  ] as const)('sends %s, naming its unit', async (_case, order, amount, amountMinor, amountUnit) => {
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction('refund', { amount, transactionId: 'REFUND-REF-0001' });
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      ORDER_FIXTURE_SELLER,
      expect.objectContaining({
        kind: 'refund.record_external',
        aggregateId: `order:${order.id}`,
        expectedRevision: order.revision,
        payload: { orderId: order.id, amountMinor, transactionId: 'REFUND-REF-0001', amountUnit },
      }),
    );
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.rootError).toBeUndefined();
  });

  it('sends no unit without a projected cap', async () => {
    const order = paypalOrder();
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction('refund', { amount: '1.00', transactionId: 'REFUND-REF-0002' });
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    const [, command] = execute.mock.calls[0]!;
    expect(command).toMatchObject({ kind: 'refund.record_external' });
    expect(command.payload).toEqual({ orderId: order.id, amountMinor: 100, transactionId: 'REFUND-REF-0002' });
  });

  it("sends a return request in the order total's units", async () => {
    const order = createOrderFixture('delivered');
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction('return', { reason: 'r'.repeat(1_000) });
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(execute).toHaveBeenCalledWith(
      ORDER_FIXTURE_SELLER,
      expect.objectContaining({
        kind: 'return.request',
        payload: { orderId: order.id, reason: 'r'.repeat(1_000), requestedAmountMinor: 13_700 },
      }),
    );
  });

  it.each([
    ['cancel', createOrderFixture('paid'), 500, 'Keep the reason to 500 characters.'],
    ['return', createOrderFixture('delivered'), 1_000, 'Keep the reason to 1,000 characters.'],
  ] as const)('refuses a %s reason over the service limit in the field', async (action, order, max, message) => {
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction(action, { reason: 'r'.repeat(max + 1) });
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('reason').error?.message).toBe(message);
  });

  it('sends a cancellation reason at the service limit', async () => {
    const order = createOrderFixture('paid');
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction('cancel', { reason: 'r'.repeat(500) });
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(execute).toHaveBeenCalledWith(
      ORDER_FIXTURE_SELLER,
      expect.objectContaining({
        kind: 'order.cancel_request',
        payload: { orderId: order.id, reason: 'r'.repeat(500) },
      }),
    );
  });

  it('says in the dialog when the Shop refuses the command it built, and sends nothing', async () => {
    // An order id the command contract cannot address: the form accepts the
    // refund, the contract refuses the payload `actOnOrder` would send.
    const order = paypalOrder({ id: 'not-an-order-id' });
    const { result } = renderRefund(order);

    act(() => {
      result.current.setAction('refund', { amount: '1.00', transactionId: 'REFUND-REF-0003' });
    });
    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(result.current.rootError).toBe(ORDER_COMMAND_UNSENDABLE_COPY);
  });
});
