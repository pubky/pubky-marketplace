import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketplaceOrderPayment } from '@/hooks/useMarketplaceOrderPayment/useMarketplaceOrderPayment';
import { CHECKOUT_HOLD_COPY } from '@/libs/commerce/checkout-hold';
import type { PaymentMethodKind } from '@/libs/commerce/payment-methods';
import {
  USDT_ACCEPT_BY_COPY,
  USDT_BUYER_PHASE_COPY,
  USDT_FINALITY_EXPECTATION_COPY,
  USDT_FUNDS_HINT,
  USDT_RECHECKING_NEXT_STEP_COPY,
  USDT_SELLER_PHASE_COPY,
  USDT_SELLER_REVIEW_COPY,
  USDT_WALLET_HINT,
} from '@/libs/commerce/usdt-buyer-status';
import { createOrderFixture, createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { createUsdtOrderFixture, USDT_ORDER_FIELDS, type UsdtOrderPhase } from '@/test/fixtures/commerce/usdt-orders';
import { MarketplacePaymentStatusCard } from './MarketplacePaymentStatusCard';

const auth = vi.hoisted(() => ({ currentUserPubky: 'b'.repeat(52) }));
const methodPayment = vi.hoisted(() => ({
  bind: vi.fn(),
  availableMethods: null as PaymentMethodKind[] | null,
}));

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
    getOrFetchListing: vi.fn(async () => ({ digitalLock: null })),
    executeMarketplaceCommand: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: auth.currentUserPubky }),
}));

function renderCard(
  order: ReturnType<typeof createUsdtOrderFixture>['order'],
  payment: ReturnType<typeof createUsdtOrderFixture>['payment'],
  isBuyer: boolean,
) {
  auth.currentUserPubky = isBuyer ? order.buyerPubky : order.sellerPubky;
  return render(
    <MarketplacePaymentStatusCard
      order={order}
      payment={payment}
      isBuyer={isBuyer}
      adapterMode="transaction-service"
      advancePayment={async () => false}
      onPaymentChanged={() => {}}
    />,
  );
}

function renderPhase(phase: UsdtOrderPhase, isBuyer: boolean) {
  const { order, payment } = createUsdtOrderFixture(phase);
  return renderCard(order, payment, isBuyer);
}

beforeEach(() => {
  methodPayment.bind.mockReset();
  methodPayment.availableMethods = null;
  vi.mocked(useMarketplaceOrderPayment).mockImplementation(() => ({
    availableMethods: methodPayment.availableMethods,
    bitcoinOfferUnavailable: false,
    paykitOutage: false,
    configError: null,
    deliveryAddress: null,
    pendingAction: null,
    bind: methodPayment.bind,
    markPaid: vi.fn(),
    confirmReceived: vi.fn(),
  }));
});

describe('MarketplacePaymentStatusCard — USDT orders', () => {
  it('shows a bound unpaid USDT order with the exact amount, the network and the Bitkit hints', () => {
    const { container } = renderPhase('awaiting', true);

    expect(screen.getByText('USDT')).toBeInTheDocument();
    expect(screen.getByTestId('usdt-amount-due')).toHaveTextContent('Pay exactly 137.000000 USDT');
    expect(screen.getByTestId('usdt-network')).toHaveTextContent('USDT0 on Arbitrum One');
    expect(screen.getByTestId('usdt-awaiting-status')).toHaveTextContent(USDT_BUYER_PHASE_COPY.awaiting);
    expect(screen.getByTestId('usdt-wallet-hint')).toHaveTextContent(`${USDT_WALLET_HINT} ${USDT_FUNDS_HINT}`);
    expect(container).not.toHaveTextContent(/Bitcoin|₿|sats/);
    expect(screen.queryByTestId('bitcoin-amount-breakdown')).not.toBeInTheDocument();
  });

  it('tells the buyer of an unpaid USDT order when to approve in Bitkit and that shipping waits for finality', () => {
    renderPhase('awaiting', true);

    expect(screen.getByTestId('usdt-accept-by')).toHaveTextContent('Approve in Bitkit within 15 minutes.');
    expect(screen.getByTestId('usdt-accept-by')).toHaveTextContent(USDT_ACCEPT_BY_COPY);
    expect(screen.getByTestId('usdt-finality-note')).toHaveTextContent(
      'The seller ships once Arbitrum finalizes your payment, usually within minutes.',
    );
    expect(screen.getByTestId('usdt-finality-note')).toHaveTextContent(USDT_FINALITY_EXPECTATION_COPY);
  });

  it('leaves the finality note off a digital USDT order, which releases at inclusion', () => {
    const { order, payment } = createUsdtOrderFixture('awaiting', { fulfillment: 'digital' });
    renderCard(order, payment, true);

    expect(screen.queryByTestId('usdt-finality-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('usdt-accept-by')).toBeInTheDocument();
  });

  it('drops the accept-by line and does not claim non-delivery when the request could not be confirmed', () => {
    const { order, payment } = createUsdtOrderFixture('awaiting', { paykitDeliveryState: 'failed' });
    renderCard(order, payment, true);

    expect(screen.getByTestId('paykit-delivery-failed')).toHaveTextContent(
      "We couldn't confirm your wallet got the payment request. Check Bitkit for it; if it's not there, add the seller as a contact in Bitkit, then check out again.",
    );
    expect(screen.queryByTestId('usdt-accept-by')).not.toBeInTheDocument();
  });

  it.each(['received', 'final', 'rechecking'] as const)(
    'shows no unconfirmed-delivery copy once the USDT payment is seen (%s), even when delivery reads failed',
    (phase) => {
      const { order, payment } = createUsdtOrderFixture(phase, { paykitDeliveryState: 'failed' });
      renderCard(order, payment, true);

      expect(screen.queryByTestId('paykit-delivery-failed')).not.toBeInTheDocument();
      expect(screen.queryByTestId('usdt-payment-awaiting')).not.toBeInTheDocument();
    },
  );

  it('shows no unconfirmed-delivery copy to the seller of an unpaid USDT order', () => {
    const { order, payment } = createUsdtOrderFixture('awaiting', { paykitDeliveryState: 'failed' });
    renderCard(order, payment, false);

    expect(screen.queryByTestId('paykit-delivery-failed')).not.toBeInTheDocument();
  });

  it('tells the buyer of an elapsed USDT checkout not to pay a request it could not confirm', () => {
    const payment = createPaymentFixture('expired', { adapter: 'paykit' });
    const order = createOrderFixture('cancelled', {
      paymentId: payment.id,
      cancellationReason: 'payment window elapsed',
      ...USDT_ORDER_FIELDS,
      paykitDeliveryState: 'failed',
    });
    renderCard(order, payment, true);

    expect(screen.getByTestId('paykit-delivery-failed')).toHaveTextContent(
      "We couldn't confirm your wallet got the payment request before the payment window ended. If you find it in Bitkit, don't pay it. This checkout has ended; check out again.",
    );
  });

  it('shows the seller of an unpaid USDT order neither the accept-by nor the buyer finality note', () => {
    renderPhase('awaiting', false);

    expect(screen.queryByTestId('usdt-accept-by')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usdt-finality-note')).not.toBeInTheDocument();
  });

  it('keeps the seller of an unpaid USDT order informed without a pay amount', () => {
    renderPhase('awaiting', false);

    expect(screen.queryByTestId('usdt-amount-due')).not.toBeInTheDocument();
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(USDT_SELLER_PHASE_COPY.awaiting);
  });

  it('tells the buyer a payment at inclusion is received and that shipping waits for finality', () => {
    renderPhase('received', true);

    expect(screen.getByText('Payment received')).toBeInTheDocument();
    expect(screen.getByTestId('usdt-paid-as')).toHaveTextContent('$137.00, paid as 137.000000 USDT');
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(USDT_BUYER_PHASE_COPY.received);
  });

  it('tells the seller not to ship until Arbitrum finalizes the payment, and that it unlocks on its own', () => {
    renderPhase('received', false);

    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(USDT_SELLER_PHASE_COPY.received);
  });

  it.each([
    [true, USDT_BUYER_PHASE_COPY.final],
    [false, USDT_SELLER_PHASE_COPY.final],
  ])('says a final payment is confirmed (buyer: %s)', (isBuyer, copy) => {
    renderPhase('final', isBuyer);

    expect(screen.getByText('Payment confirmed')).toBeInTheDocument();
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(copy);
    expect(screen.getByTestId('usdt-paid-as')).toHaveTextContent('$137.00, paid as 137.000000 USDT');
  });

  it.each([
    [true, USDT_BUYER_PHASE_COPY.rechecking],
    [false, USDT_SELLER_PHASE_COPY.rechecking],
  ])('says a reorged payment is being re-checked and never shows it as settled (buyer: %s)', (isBuyer, copy) => {
    const { container } = renderPhase('rechecking', isBuyer);

    expect(screen.getByText('Payment being re-checked')).toBeInTheDocument();
    expect(screen.getByTestId('usdt-phase-copy')).toHaveTextContent(copy);
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-check')).toBeNull();
  });

  it('tells the seller what to do if a re-checked payment does not come back, and not the buyer', () => {
    const { unmount } = renderPhase('rechecking', false);
    expect(screen.getByTestId('usdt-recheck-next-step')).toHaveTextContent(USDT_RECHECKING_NEXT_STEP_COPY);
    unmount();

    renderPhase('rechecking', true);
    expect(screen.queryByTestId('usdt-recheck-next-step')).not.toBeInTheDocument();
  });

  it.each(['received', 'final'] as const)('shows no re-check next step while the payment is %s', (phase) => {
    renderPhase(phase, false);

    expect(screen.queryByTestId('usdt-recheck-next-step')).not.toBeInTheDocument();
  });

  it.each([
    ['late_settlement', USDT_SELLER_REVIEW_COPY.late_settlement],
    ['amount_mismatch', USDT_SELLER_REVIEW_COPY.amount_mismatch],
  ] as const)('gives the seller a USDT line for a %s review instead of the generic one', (reviewReason, copy) => {
    const { order } = createUsdtOrderFixture('final');
    renderCard(order, createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason }), false);

    expect(screen.getByTestId('payment-manual-review-copy')).toHaveTextContent(copy);
    expect(screen.getByTestId('payment-manual-review-copy')).not.toHaveTextContent(/verified event/);
  });

  it.each(['unpinned_legacy', null] as const)(
    'keeps the generic review line for the seller when the reason is %s',
    (reviewReason) => {
      const { order } = createUsdtOrderFixture('final');
      renderCard(order, createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason }), false);

      expect(screen.getByTestId('payment-manual-review-copy')).toHaveTextContent(/A verified event arrived/);
    },
  );

  it('leaves the buyer review copy untouched by the seller line', () => {
    const { order } = createUsdtOrderFixture('final');
    renderCard(
      order,
      createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason: 'late_settlement' }),
      true,
    );

    expect(screen.getByTestId('payment-manual-review-copy')).toHaveTextContent(
      'Payment received — the seller is reviewing it.',
    );
  });

  it('puts an amount-mismatch review in USDT terms for the buyer', () => {
    const { order } = createUsdtOrderFixture('final');
    renderCard(
      order,
      createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason: 'amount_mismatch' }),
      true,
    );

    expect(screen.getByTestId('payment-manual-review-copy')).toHaveTextContent(
      'The USDT amount does not match. The seller is reviewing it.',
    );
  });

  it('names USDT, not Bitcoin, when the seller must return money for a USDT payment', () => {
    const { order } = createUsdtOrderFixture('final');
    const { container } = renderCard(
      order,
      createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason: 'refund_required' }),
      false,
    );

    expect(container).toHaveTextContent(CHECKOUT_HOLD_COPY.refundRequiredUsdtSeller);
    expect(container).not.toHaveTextContent(/bitcoin/i);
  });

  it('never labels a Locks-verified receipt Bitcoin, whichever rail paid it', () => {
    const payment = createPaymentFixture('confirmed', { adapter: 'locks', locksBundleId: undefined });
    const order = createOrderFixture('paid', { paymentId: payment.id, paymentMethod: null });
    const { container } = renderCard(order, payment, true);

    expect(screen.getByText('Locks/Paykit')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Bitcoin|₿/);
    expect(screen.queryByTestId('usdt-payment-summary')).not.toBeInTheDocument();
  });

  it('leaves a Bitcoin order without any USDT copy', () => {
    const payment = createPaymentFixture('awaiting_entitlement', { adapter: 'paykit' });
    const order = createOrderFixture('pending_payment', {
      paymentId: payment.id,
      paymentMethod: 'bitcoin',
      paykitRequestState: 'pending',
      paykitDeliveryState: 'delivered',
    });
    const { container } = renderCard(order, payment, true);

    expect(screen.getByText('₿ Bitcoin')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/USDT|Arbitrum/);
    expect(screen.queryByTestId('usdt-payment-summary')).not.toBeInTheDocument();
  });

  it('keeps showing a USDT order that is no longer offered, whatever the flag says', () => {
    renderPhase('received', true);

    expect(screen.getByTestId('usdt-payment-summary')).toBeInTheDocument();
  });
});

describe('MarketplacePaymentStatusCard — method picker', () => {
  function unboundOrder() {
    const payment = createPaymentFixture('awaiting_entitlement', { adapter: 'paykit' });
    const order = createOrderFixture('pending_payment', {
      paymentId: payment.id,
      paymentMethod: null,
      holdExpiresAt: '2026-08-20T21:15:00.000Z',
    });
    return { order, payment };
  }

  it('offers Continue with USDT beside Bitcoin and binds usdt', async () => {
    methodPayment.availableMethods = ['bitcoin', 'usdt', 'paypal'];
    const { order, payment } = unboundOrder();
    renderCard(order, payment, true);

    const button = screen.getByRole('button', { name: /Continue with USDT/ });
    expect(
      within(button.parentElement as HTMLElement).getByRole('button', { name: /Continue with Bitcoin/ }),
    ).toBeVisible();
    await userEvent.setup().click(button);

    expect(methodPayment.bind).toHaveBeenCalledWith('usdt');
  });

  it('shows no USDT button when the order picker does not offer it', () => {
    methodPayment.availableMethods = ['bitcoin', 'paypal'];
    const { order, payment } = unboundOrder();
    renderCard(order, payment, true);

    expect(screen.queryByRole('button', { name: /USDT/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Bitcoin/ })).toBeVisible();
  });
});
