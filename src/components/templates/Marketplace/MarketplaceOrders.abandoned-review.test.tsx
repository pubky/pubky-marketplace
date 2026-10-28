import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// The Orders page with the real payment card: an abandoned USDT review has
// to read as received money owed back on every surface of the order, not as
// a payment that never came.

setupFixedDateLocale();

setHeavySuiteBudgets();

const ordersState = vi.hoisted(() => ({
  currentUserPubky: 'b'.repeat(52),
  orders: [] as unknown[],
}));

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
    confirmReceived: vi.fn(),
  }),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) =>
      selector({ currentUserPubky: ordersState.currentUserPubky }),
    {
      getState: () => ({
        currentUserPubky: ordersState.currentUserPubky,
        selectCurrentUserPubky: () => ordersState.currentUserPubky,
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

afterEach(() => {
  vi.restoreAllMocks();
});

/** A USDT order whose underpaid transfer was reviewed and then abandoned after seven days. */
function abandonedUsdtReview() {
  const base = createOrderFixture('cancelled');
  const order = createUsdtOrderFixture('cancelled', {
    id: '018f47d2-6a27-7c23-a49d-000000000901',
    paymentId: '018f47d2-6a27-7c23-a49d-000000000902',
    paymentMethod: 'paykit',
    receiptId: null,
    cancellationReason: 'closed after manual review',
    buyerPubky: ORDER_FIXTURE_BUYER,
    sellerPubky: ORDER_FIXTURE_SELLER,
    lines: [{ ...base.lines[0], title: 'Abandoned USDT boots' }],
  });
  const payment = createPaymentFixture('expired', {
    id: order.paymentId,
    orderId: order.id,
    adapter: 'paykit',
    reviewReason: 'amount_mismatch',
    resolutionOutcome: 'abandoned',
    resolutionBasis: 'seller_unresponsive',
  });
  return { order, payment, receipt: null };
}

async function openOrder() {
  render(<MarketplaceOrders />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: /^All/ }));
  await waitFor(() => expect(screen.getByText('Abandoned USDT boots')).toBeInTheDocument());
}

describe('MarketplaceOrders with the real payment card: an abandoned USDT review', () => {
  it('tells the buyer the money arrived and asks for a refund address', async () => {
    ordersState.currentUserPubky = ORDER_FIXTURE_BUYER;
    ordersState.orders = [abandonedUsdtReview()];
    await openOrder();

    expect(screen.getByTestId('payment-review-abandoned')).toHaveTextContent(
      'Your payment arrived, but its review closed after seven days without the seller’s decision',
    );
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(/^Your USDT payment was received but not applied/);
    expect(
      within(screen.getByTestId('usdt-refund-buyer')).getByRole('button', { name: 'Confirm refund address' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/before a verified payment arrived/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for your USDT payment/)).not.toBeInTheDocument();
    expect(screen.queryByText('Checkout ended before payment.')).not.toBeInTheDocument();
  });

  it('tells the seller to return the money', async () => {
    ordersState.currentUserPubky = ORDER_FIXTURE_SELLER;
    ordersState.orders = [abandonedUsdtReview()];
    await openOrder();

    expect(screen.getByTestId('payment-review-abandoned')).toHaveTextContent(
      'Return it to the buyer and record the refund.',
    );
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(/^The buyer's USDT payment was received/);
    expect(screen.getByTestId('usdt-refund-seller')).toBeInTheDocument();
    expect(screen.queryByText(/before a verified payment arrived/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the buyer's USDT payment/)).not.toBeInTheDocument();
  });
});
