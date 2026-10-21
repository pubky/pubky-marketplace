import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketplaceOrderPayment } from '@/hooks/useMarketplaceOrderPayment/useMarketplaceOrderPayment';
import { PAYMENT_RECEIVED_REVIEW_COPY } from '@/libs/commerce/bitcoin-buyer-status';
import { APPROVE_IN_BITKIT_FALLBACK_COPY } from '@/libs/commerce/checkout-hold';
import { PAYMENT_RAIL_BADGE } from '@/libs/commerce/paykit-rail';
import {
  PAYKIT_USDT_FINALITY_EXPECTATION_COPY,
  USDT_BUYER_PHASE_COPY,
  USDT_SELLER_PHASE_COPY,
  USDT_WALLET_HINT,
} from '@/libs/commerce/usdt-buyer-status';
import { createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { createPaykitOrderFixture, type PaykitOrderPhase } from '@/test/fixtures/commerce/paykit-orders';
import { setupFixedDateLocale } from '@/test-utils/date-locale';
import { MarketplacePaymentStatusCard } from './MarketplacePaymentStatusCard';

setupFixedDateLocale();

const auth = vi.hoisted(() => ({ currentUserPubky: 'b'.repeat(52) }));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getDeployEnv: () => 'production' };
});

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
  useMarketplaceOrderPayment: vi.fn(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getOrFetchListingIfFound: vi.fn(async () => ({ digitalLock: null })),
    executeMarketplaceCommand: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: auth.currentUserPubky }),
}));

function renderCard(
  { order, payment }: ReturnType<typeof createPaykitOrderFixture>,
  isBuyer: boolean,
  adapter: 'transaction-service' = 'transaction-service',
) {
  auth.currentUserPubky = isBuyer ? order.buyerPubky : order.sellerPubky;
  return render(
    <MarketplacePaymentStatusCard
      order={order}
      payment={payment}
      isBuyer={isBuyer}
      adapterMode={adapter}
      advancePayment={async () => false}
      onPaymentChanged={() => {}}
    />,
  );
}

function renderPhase(phase: PaykitOrderPhase, isBuyer: boolean, overrides = {}) {
  return renderCard(createPaykitOrderFixture(phase, overrides), isBuyer);
}

beforeEach(() => {
  vi.mocked(useMarketplaceOrderPayment).mockImplementation(() => ({
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
  }));
});

describe('MarketplacePaymentStatusCard — one Paykit order before payment', () => {
  it('tells the buyer to pay in Bitkit with Bitcoin or USDT, without naming a rail yet', () => {
    const { container } = renderPhase('unpaid', true, { createdAt: '2026-08-20T20:46:00.000Z' });

    expect(screen.getByText(PAYMENT_RAIL_BADGE.paykit)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_RAIL_BADGE.bitcoin)).not.toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_RAIL_BADGE.usdt)).not.toBeInTheDocument();
    expect(screen.getByTestId('paykit-awaiting-status')).toHaveTextContent('Pay in Bitkit (Bitcoin or USDT)');
    expect(screen.getByTestId('paykit-awaiting-status')).toHaveTextContent('choose Bitcoin or USDT');
    expect(screen.getByTestId('paykit-accept-by')).toHaveTextContent('Approve in Bitkit by 20 Aug 2026, 21:00.');
    expect(container).not.toHaveTextContent(/Pay exactly/);
    expect(screen.queryByTestId('usdt-payment-awaiting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bitcoin-payment-seen')).not.toBeInTheDocument();
  });

  it('names an approval deadline before its Pay by line, as Bitkit expires an unapproved request first', () => {
    renderPhase('unpaid', true, { createdAt: '2026-08-20T20:46:00.000Z', holdExpiresAt: '2026-08-20T21:45:00.000Z' });

    expect(screen.getByTestId('paykit-accept-by')).toHaveTextContent('Approve in Bitkit by 20 Aug 2026, 21:15.');
    expect(screen.getByTestId('paykit-accept-by')).not.toHaveTextContent(/minutes/);
    expect(screen.getByText('Pay by 20 Aug 2026, 21:45. If the window ends, the item restocks.')).toBeInTheDocument();
  });

  it('names no window once the order carries no deadline', () => {
    renderPhase('unpaid', true, { holdExpiresAt: null });

    expect(screen.getByTestId('paykit-accept-by')).toHaveTextContent(APPROVE_IN_BITKIT_FALLBACK_COPY);
  });

  it('adds the USDT wallet hint and finality expectation only when USDT is offered', () => {
    renderPhase('unpaid', true);
    expect(screen.getByTestId('paykit-usdt-wallet-hint')).toHaveTextContent(USDT_WALLET_HINT);
    expect(screen.getByTestId('paykit-usdt-finality-note')).toHaveTextContent(PAYKIT_USDT_FINALITY_EXPECTATION_COPY);
  });

  it('names Bitcoin alone, with no USDT hint, when the order offered only Bitcoin', () => {
    const { container } = renderPhase('unpaid', true, { acceptedAssets: ['BTC'] });

    expect(screen.getByTestId('paykit-awaiting-status')).toHaveTextContent('Pay in Bitkit (Bitcoin)');
    expect(container).not.toHaveTextContent(/USDT/);
  });

  it('treats an order that carries no asset list as Bitcoin only', () => {
    const { container } = renderPhase('unpaid', true, { acceptedAssets: undefined });

    expect(screen.getByTestId('paykit-awaiting-status')).toHaveTextContent('Pay in Bitkit (Bitcoin)');
    expect(container).not.toHaveTextContent(/USDT/);
  });

  it('does not claim non-delivery when the request could not be confirmed', () => {
    const { container } = renderPhase('unpaid', true, { paykitDeliveryState: 'failed' });

    expect(screen.getByTestId('paykit-delivery-failed')).toHaveTextContent(
      "We couldn't confirm your wallet got the payment request. Check Bitkit for it; if it's not there, add the seller as a contact in Bitkit, cancel this checkout, then check out again.",
    );
    expect(container).not.toHaveTextContent(/didn.t receive/);
    expect(container).not.toHaveTextContent(/Payment request sent/);
    expect(screen.queryByTestId('paykit-awaiting-status')).not.toBeInTheDocument();
  });

  it('puts the checkout action next to the unconfirmed-delivery copy, else under the awaiting status', () => {
    const failed = createPaykitOrderFixture('unpaid', { paykitDeliveryState: 'failed' });
    const { unmount } = render(
      <MarketplacePaymentStatusCard
        order={failed.order}
        payment={failed.payment}
        isBuyer
        adapterMode="transaction-service"
        advancePayment={async () => false}
        onPaymentChanged={() => {}}
        checkoutActions={<button type="button">Cancel checkout</button>}
      />,
    );
    expect(screen.getByTestId('paykit-delivery-failed').parentElement).toContainElement(
      screen.getByRole('button', { name: 'Cancel checkout' }),
    );
    unmount();

    const delivered = createPaykitOrderFixture('unpaid');
    render(
      <MarketplacePaymentStatusCard
        order={delivered.order}
        payment={delivered.payment}
        isBuyer
        adapterMode="transaction-service"
        advancePayment={async () => false}
        onPaymentChanged={() => {}}
        checkoutActions={<button type="button">Cancel checkout</button>}
      />,
    );
    expect(screen.getByTestId('paykit-awaiting-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel checkout' })).toBeInTheDocument();
  });

  it.each([
    ['pending', 'pending', true, true],
    ['pending', null, true, true],
    ['pending', 'failed', false, false],
    ['awaiting_seller_confirmation', 'failed', true, false],
  ] as const)(
    'for a request %s whose delivery reads %s (buyer: %s), renders the passed checkout action: %s',
    (paykitRequestState, paykitDeliveryState, isBuyer, shown) => {
      const { order, payment } = createPaykitOrderFixture('unpaid', { paykitRequestState, paykitDeliveryState });
      render(
        <MarketplacePaymentStatusCard
          order={order}
          payment={payment}
          isBuyer={isBuyer}
          adapterMode="transaction-service"
          advancePayment={async () => false}
          onPaymentChanged={() => {}}
          checkoutActions={<button type="button">Cancel checkout</button>}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Cancel checkout' }) !== null).toBe(shown);
    },
  );

  it('tells the buyer of an elapsed checkout not to pay a request it could not confirm', () => {
    const payment = createPaymentFixture('expired', { adapter: 'paykit' });
    const { order } = createPaykitOrderFixture('unpaid', {
      state: 'cancelled',
      paymentId: payment.id,
      cancellationReason: 'payment window elapsed',
      paykitDeliveryState: 'failed',
    });
    renderCard({ order, payment }, true);

    expect(screen.getByTestId('paykit-delivery-failed')).toHaveTextContent(
      "We couldn't confirm your wallet got the payment request before the payment window ended. If you find it in Bitkit, don't pay it. This checkout has ended; check out again.",
    );
  });

  it('shows the seller the neutral badge and no buyer instructions', () => {
    renderPhase('unpaid', false);

    expect(screen.getByText(PAYMENT_RAIL_BADGE.paykit)).toBeInTheDocument();
    expect(screen.queryByTestId('paykit-payment-awaiting')).not.toBeInTheDocument();
  });

  it('switches to the Bitcoin tables once the service sees a Bitcoin payment', () => {
    renderPhase('unpaid', true, { paykitRequestState: 'awaiting_seller_confirmation' });

    expect(screen.getByTestId('bitcoin-payment-seen')).toBeInTheDocument();
    expect(screen.queryByTestId('paykit-payment-awaiting')).not.toBeInTheDocument();
  });
});

describe('MarketplacePaymentStatusCard — one Paykit order after payment', () => {
  it('follows Bitcoin when the observed asset is BTC', () => {
    const { container } = renderPhase('paid-bitcoin', true);

    expect(screen.getByText(PAYMENT_RAIL_BADGE.bitcoin)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_RAIL_BADGE.paykit)).not.toBeInTheDocument();
    expect(screen.queryByTestId('usdt-paid-as')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/USDT/);
  });

  it.each([
    [true, USDT_BUYER_PHASE_COPY.received],
    [false, USDT_SELLER_PHASE_COPY.received],
  ])('follows USDT when the observed asset is USDT (buyer: %s)', (isBuyer, copy) => {
    renderPhase('paid-usdt', isBuyer);

    expect(screen.getByText(PAYMENT_RAIL_BADGE.usdt)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_RAIL_BADGE.paykit)).not.toBeInTheDocument();
    expect(screen.getByTestId('usdt-paid-as')).toHaveTextContent('$137.00, paid as 137.000000 USDT');
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(copy);
  });

  it('tells the buyer a USDT payment held for review was received', () => {
    const { order } = createPaykitOrderFixture('paid-usdt');
    renderCard({ order, payment: createPaymentFixture('manual_review', { adapter: 'paykit' }) }, true);

    expect(screen.getByTestId('payment-manual-review-copy')).toHaveTextContent(PAYMENT_RECEIVED_REVIEW_COPY);
  });

  it('offers a seller no Bitcoin confirmation for a USDT payment', () => {
    const { order } = createPaykitOrderFixture('paid-usdt');
    renderCard(
      {
        order: { ...order, state: 'pending_payment', paykitRequestState: 'awaiting_seller_confirmation' },
        payment: createPaymentFixture('awaiting_entitlement', { adapter: 'paykit' }),
      },
      false,
    );

    expect(screen.queryByTestId('seller-bitcoin-confirm-prompt')).not.toBeInTheDocument();
  });
});

describe('MarketplacePaymentStatusCard — a payment on both rails', () => {
  const heldForReview = (observation: Record<string, unknown> | null) => {
    const { order } = createPaykitOrderFixture('unpaid', {
      state: 'pending_payment',
      paykitObservation: observation as never,
    });
    return {
      order,
      payment: createPaymentFixture('manual_review', {
        adapter: 'paykit',
        manualReviewEnteredAt: '2026-08-20T21:00:00.000Z',
      }),
    };
  };

  it('lets the seller resolve it with the neutral title and names the other rail', () => {
    renderCard(
      heldForReview({ asset: 'BTC', observedUnits: 6173, otherRailAsset: 'USDT', otherRailAmount: '5000000' }),
      false,
    );

    expect(screen.getByTestId('seller-bitcoin-resolve-prompt')).toHaveTextContent('Resolve payment review');
    expect(screen.getByText('Also paid in')).toBeInTheDocument();
    expect(screen.getByText('USDT')).toBeInTheDocument();
    expect(screen.getByText('5000000')).toBeInTheDocument();
  });

  it('names no other rail when the service reports none', () => {
    renderCard(heldForReview({ asset: 'BTC' }), false);

    expect(screen.getByTestId('seller-bitcoin-resolve-prompt')).toBeInTheDocument();
    expect(screen.queryByText('Also paid in')).not.toBeInTheDocument();
  });

  it('shows the buyer the generic review line, in no rail terms', () => {
    renderCard(heldForReview({ asset: 'BTC', otherRailAsset: 'USDT' }), true);

    expect(screen.getByTestId('payment-manual-review-copy')).toBeInTheDocument();
    expect(screen.queryByTestId('seller-bitcoin-resolve-prompt')).not.toBeInTheDocument();
  });
});

describe('MarketplacePaymentStatusCard — legacy orders', () => {
  it.each([
    ['bitcoin', PAYMENT_RAIL_BADGE.bitcoin],
    ['usdt', PAYMENT_RAIL_BADGE.usdt],
  ] as const)('keeps rendering a %s order from its method alone', (method, badge) => {
    const { order, payment } = createPaykitOrderFixture('unpaid', {
      paymentMethod: method,
      paymentAsset: undefined,
      acceptedAssets: undefined,
    });
    renderCard({ order, payment }, true);

    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_RAIL_BADGE.paykit)).not.toBeInTheDocument();
    expect(screen.queryByTestId('paykit-payment-awaiting')).not.toBeInTheDocument();
  });
});
