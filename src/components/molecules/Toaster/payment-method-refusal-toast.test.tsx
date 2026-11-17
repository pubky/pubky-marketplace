import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { READER_WALLET_SETUP_TOAST_MS, showPaymentMethodRefusalToast } from './payment-method-refusal-toast';
import { toast } from './toast';
import { dispatch, getSnapshot } from './toast.store';
import { Toaster } from './Toaster';

const refusal = (reason: string) =>
  new AppError({
    category: ErrorCategory.Client,
    code: ClientErrorCode.BAD_REQUEST,
    message: 'SENTINEL',
    service: ErrorService.Marketplace,
    operation: 'bindPaymentMethod',
    context: { statusCode: 409, reason, serviceCode: 'INVALID_STATE' },
  });

describe('showPaymentMethodRefusalToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    for (const item of getSnapshot().toasts) dispatch({ type: 'REMOVE_TOAST', toastId: item.id });
    vi.useRealTimers();
  });

  it('keeps wallet setup retry available after 59 seconds and runs it only on click', () => {
    const onRetry = vi.fn();
    render(<Toaster />);

    act(() => {
      showPaymentMethodRefusalToast({ error: refusal('buyer_paykit_wallet_setup_needed'), fallback: 'x', onRetry });
    });

    expect(screen.getByText('Reader wallet setup needed')).toBeInTheDocument();
    expect(
      screen.getByText('Finish setting up Bitkit (or another Paykit wallet) for this pubky, then try again.'),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(READER_WALLET_SETUP_TOAST_MS - 1_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Reader wallet setup needed')).not.toBeInTheDocument();
  });

  it('expires wallet setup at 60 seconds without retrying automatically', () => {
    const onRetry = vi.fn();
    render(<Toaster />);
    act(() => {
      showPaymentMethodRefusalToast({ error: refusal('buyer_paykit_wallet_setup_needed'), fallback: 'x', onRetry });
      vi.advanceTimersByTime(READER_WALLET_SETUP_TOAST_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Reader wallet setup needed')).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps the separate OK action when no retry callback is available', () => {
    render(<Toaster />);
    act(() => {
      showPaymentMethodRefusalToast({ error: refusal('buyer_paykit_wallet_setup_needed'), fallback: 'x' });
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('Reader wallet setup needed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('Reader wallet setup needed')).not.toBeInTheDocument();
  });

  it('leaves a new toast from the retry callback open', () => {
    render(<Toaster />);
    act(() => {
      showPaymentMethodRefusalToast({
        error: refusal('buyer_paykit_wallet_setup_needed'),
        fallback: 'x',
        onRetry: () => {
          toast({ title: 'Payment request sent' });
        },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Payment request sent')).toBeInTheDocument();
    expect(screen.queryByText('Reader wallet setup needed')).not.toBeInTheDocument();
  });

  it('keeps other refusals as a plain mapped toast with the normal three-second lifetime', () => {
    const onRetry = vi.fn();
    render(<Toaster />);

    act(() => {
      showPaymentMethodRefusalToast({
        error: refusal('buyer_paykit_wallet_required'),
        fallback: 'x',
        title: 'Payment action failed',
        onRetry,
      });
    });

    expect(screen.getByText('Payment action failed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect Bitkit to pay with Bitcoin: this pubky has no Paykit wallet that can receive a payment request.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(screen.getByText('Payment action failed')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Payment action failed')).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
