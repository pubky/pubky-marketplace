import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOrderFixture,
  createPaymentFixture,
  createUsdtOrderFixture,
  ORDER_FIXTURE_BUYER,
  ORDER_FIXTURE_SELLER,
} from '@/test/fixtures/commerce/orders';
import { setupFixedDateLocale } from '@/test-utils/date-locale';
import { setHeavySuiteBudgets } from '@/test-utils/load-budget';
import { MarketplaceOrders } from './MarketplaceOrders';

// The Orders page with the real payment card: a pending order whose money
// waits for the seller is still a reservation, and that reservation must
// carry the seller's confirmation, or the hold lapses unconfirmed.

setupFixedDateLocale();

setHeavySuiteBudgets();

const ordersState = vi.hoisted(() => ({ orders: [] as unknown[] }));
const confirmReceived = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMarketplaceOrders/useMarketplaceOrders', () => ({
  useMarketplaceOrders: () => ({
    orders: ordersState.orders,
    isLoading: false,
    error: null,
    needsSession: false,
    adapterMode: 'transaction-service',
    refresh: vi.fn(),
    advancePayment: vi.fn(),
    actOnOrder: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: <T,>(action: () => T) => action() }),
}));

vi.mock('@/hooks/useMarketplaceOrderItemMedia/useMarketplaceOrderItemMedia', () => ({
  useMarketplaceOrderItemMedia: () => null,
}));

vi.mock('@/hooks/useUserDetails/useUserDetails', () => ({
  useUserDetails: () => ({ userDetails: null, isLoading: false }),
}));

vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: () => null,
}));

vi.mock('@/hooks/useMarketplaceLocksPayment/useMarketplaceLocksPayment', () => ({
  useMarketplaceLocksPayment: () => ({
    enabled: false,
    correlation: null,
    isStarting: false,
    isUnlocking: false,
    delivery: null,
    error: null,
    pollExhausted: false,
    start: vi.fn(),
    unlock: vi.fn(),
    resumePolling: vi.fn(),
    admission: null,
  }),
}));

vi.mock('@/hooks/useBuyerPaykitWallet/useBuyerPaykitWallet', () => ({
  useBuyerPaykitWallet: () => ({ state: 'payable', recheck: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceOrderPayment/useMarketplaceOrderPayment', () => ({
  useMarketplaceOrderPayment: () => ({
    availableMethods: null,
    paykitAssets: [],
    bitcoinOfferUnavailable: false,
    paykitOutage: false,
    configError: null,
    deliveryAddress: null,
    pendingAction: null,
    bind: vi.fn(),
    markPaid: vi.fn(),
    confirmReceived,
  }),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) =>
      selector({ currentUserPubky: ORDER_FIXTURE_SELLER }),
    {
      getState: () => ({
        currentUserPubky: ORDER_FIXTURE_SELLER,
        selectCurrentUserPubky: () => ORDER_FIXTURE_SELLER,
      }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('@/stores/commerce/commerce.store', () => ({
  useCommerceStore: (selector: (state: { receiptsPublicationStatus: string }) => unknown) =>
    selector({ receiptsPublicationStatus: 'idle' }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: ({ triggerLabel }: { triggerLabel: string }) => <button>{triggerLabel}</button>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceMyReviews', () => ({
  MarketplaceMyReviews: () => <div data-testid="my-reviews" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/marketplace/orders',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  confirmReceived.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ORDER_ID = '018f47d2-6a27-7c23-a49d-000000000911';
const PAYMENT_ID = '018f47d2-6a27-7c23-a49d-000000000912';

function pendingPaypal(overrides: Partial<ReturnType<typeof createOrderFixture>>) {
  const base = createOrderFixture('pending_payment');
  const order = createOrderFixture('pending_payment', {
    id: ORDER_ID,
    paymentId: PAYMENT_ID,
    buyerPubky: ORDER_FIXTURE_BUYER,
    sellerPubky: ORDER_FIXTURE_SELLER,
    paymentMethod: 'paypal',
    paymentConfirmation: 'seller',
    fiatCheckoutUrl: 'https://www.paypal.com/checkout',
    holdExpiresAt: '2099-01-01T00:00:00.000Z',
    lines: [{ ...base.lines[0], title: 'Field boots' }],
    ...overrides,
  });
  const payment = createPaymentFixture('awaiting_entitlement', {
    id: PAYMENT_ID,
    orderId: ORDER_ID,
    adapter: 'paypal',
  });
  return { order, payment, receipt: null };
}

async function openReservations() {
  render(<MarketplaceOrders />);
  await waitFor(() => expect(screen.getByTestId('marketplace-reservations')).toBeInTheDocument());
  return screen.getByTestId('marketplace-reservations');
}

describe('MarketplaceOrders: the seller confirms a payment that waits on a reservation', () => {
  it('offers Confirm payment received for a PayPal payment the buyer reported', async () => {
    ordersState.orders = [
      pendingPaypal({ paymentReportedAt: '2026-10-28T18:45:00.000Z', fiatTransactionRef: 'TXN-1' }),
    ];
    const reservations = await openReservations();

    const confirm = within(reservations).getByRole('button', { name: 'Confirm payment received' });
    expect(within(reservations).getByTestId('seller-paypal-confirm')).toHaveTextContent(
      'The buyer reported a PayPal payment (ref TXN-1).',
    );
    await userEvent.setup().click(confirm);
    expect(confirmReceived).toHaveBeenCalledTimes(1);
  });

  it('offers Confirm payment and release for a reported PayPal payment on a digital file', async () => {
    const digital = pendingPaypal({ paymentReportedAt: '2026-10-28T18:45:00.000Z', fulfillment: 'digital' });
    digital.order = {
      ...digital.order,
      lines: digital.order.lines.map((line) => ({
        ...line,
        fulfillment: 'digital' as const,
        digitalKind: 'file' as const,
      })),
    };
    ordersState.orders = [digital];
    const reservations = await openReservations();

    await userEvent.setup().click(within(reservations).getByRole('button', { name: 'Confirm payment and release' }));
    expect(confirmReceived).toHaveBeenCalledTimes(1);
  });

  it('offers Confirm payment received for a payment PayPal reported', async () => {
    ordersState.orders = [pendingPaypal({ gatewayPaymentSeenAt: '2026-10-28T18:45:00.000Z' })];
    const reservations = await openReservations();

    expect(within(reservations).getByTestId('seller-paypal-confirm')).toHaveTextContent('PayPal reported a payment of');
    expect(within(reservations).getByRole('button', { name: 'Confirm payment received' })).toBeInTheDocument();
  });

  it('offers the USDT confirmation for a transfer in the seller window', async () => {
    const order = createUsdtOrderFixture('pending_payment', {
      id: ORDER_ID,
      paymentId: PAYMENT_ID,
      buyerPubky: ORDER_FIXTURE_BUYER,
      sellerPubky: ORDER_FIXTURE_SELLER,
      paymentMethod: 'paykit',
      paymentConfirmation: 'seller',
      paykitRequestState: 'awaiting_seller_confirmation',
      paykitSellerConfirmationDeadline: '2099-01-01T00:00:00.000Z',
      paykitObservation: {
        txid: `0x${'9f2c'.repeat(16)}`,
        asset: 'USDT',
        observedUnits: 137_000_000,
        confirmations: 2,
        amountMatched: true,
        disappeared: false,
      },
    });
    const payment = createPaymentFixture('awaiting_entitlement', {
      id: PAYMENT_ID,
      orderId: ORDER_ID,
      adapter: 'paykit',
    });
    ordersState.orders = [{ order, payment, receipt: null }];
    const reservations = await openReservations();

    expect(within(reservations).getByTestId('seller-bitcoin-confirm-prompt')).toHaveTextContent(
      'Confirm you received 137.000000 USDT',
    );
    expect(within(reservations).getByRole('button', { name: 'Confirm payment received' })).toBeInTheDocument();
  });

  it('keeps a PayPal hold nobody reported a plain reservation', async () => {
    ordersState.orders = [pendingPaypal({})];
    const reservations = await openReservations();

    expect(within(reservations).queryByRole('button', { name: 'Confirm payment received' })).not.toBeInTheDocument();
    expect(within(reservations).getByText('Held')).toBeInTheDocument();
  });
});
