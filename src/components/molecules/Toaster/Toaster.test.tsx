import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, type ToastOptions } from './toast';
import { dispatch, getSnapshot, TOAST_DURATION, TOAST_REMOVE_DELAY } from './toast.store';
import { Toaster } from './Toaster';

// Auto-dismiss plus removal delay — advancing past this empties the store.
const FULL_TOAST_LIFETIME = TOAST_DURATION + TOAST_REMOVE_DELAY;

const renderWithToast = (options: ToastOptions) => {
  const view = render(<Toaster />);
  act(() => {
    toast(options);
  });
  return view;
};

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runAllTimers();
      for (const { id } of getSnapshot().toasts) dispatch({ type: 'REMOVE_TOAST', toastId: id });
    });
    vi.useRealTimers();
  });

  it('should render empty when no toasts', () => {
    const { container } = render(<Toaster />);

    // Should render ToastProvider structure even with no toasts
    expect(container.firstChild).toBeTruthy();
  });

  it('should render toast without title when only description is provided', () => {
    renderWithToast({ description: 'Just a description' });

    expect(screen.getByText('Just a description')).toBeInTheDocument();
  });

  it('should wrap long description text instead of truncating', () => {
    const longDescription =
      'The file you are trying to upload exceeds the maximum allowed size of 100MB. Please reduce the file size and try again.';

    renderWithToast({ title: 'Upload Error', description: longDescription });

    const descriptionElement = screen.getByText(longDescription);
    expect(descriptionElement).toHaveClass('wrap-anywhere');
    expect(descriptionElement).not.toHaveClass('truncate');
  });

  it('should wrap long URL description when dismiss button is shown', () => {
    const longUrl = `https://pubky-ring-signer.example.com/auth?redirect=${'a'.repeat(120)}`;

    renderWithToast({ title: 'Link copied to clipboard', description: longUrl, dismissButton: true });

    expect(screen.getByText(longUrl)).toHaveClass('wrap-anywhere');
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('should render dismiss button that dismisses the toast when dismissButton is true', () => {
    renderWithToast({ title: 'Success', description: 'Operation completed', dismissButton: true });

    const okButton = screen.getByRole('button', { name: 'OK' });
    expect(okButton).toBeInTheDocument();
    expect(okButton).toHaveClass('border-brand');

    fireEvent.click(okButton);
    // No timer advance: the dismissal must come from the click itself,
    // not from the auto-dismiss timer.
    expect(screen.queryByText('Success')).not.toBeInTheDocument();
  });

  it('should not render dismiss button when dismissButton is not set', () => {
    renderWithToast({ title: 'Simple toast' });

    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('should apply error variant styles to dismiss ToastAction', () => {
    renderWithToast({ variant: 'error', title: 'Failed', description: 'Something went wrong', dismissButton: true });

    const okButton = screen.getByRole('button', { name: 'OK' });
    expect(okButton).toHaveClass('bg-toast-action-muted', 'text-foreground');
  });

  it('should render the generic Error title for error toasts without a title', () => {
    renderWithToast({ variant: 'error', description: 'Something went wrong' });

    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it.each([
    ['default', 'default'],
    ['error', 'error'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const)('should render %s variant with icon and data-variant attribute', (variant, expectedVariant) => {
    const { container } = renderWithToast({ variant, title: `${variant} toast` });

    const toastElement = screen.getByText(`${variant} toast`).closest('[data-cy="toast"]');
    expect(toastElement).toHaveAttribute('data-variant', expectedVariant);
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('should render an action descriptor and dismiss the toast when the action is clicked', () => {
    const handleActionClick = vi.fn();

    renderWithToast({
      title: 'Reposted',
      action: { label: 'Undo', altText: 'Undo', onClick: handleActionClick },
    });

    const actionButton = screen.getByRole('button', { name: 'Undo' });
    // Custom actions render muted on default-variant toasts (see Toaster.tsx)
    expect(actionButton).toHaveClass('bg-toast-action-muted');

    fireEvent.click(actionButton);
    expect(handleActionClick).toHaveBeenCalledTimes(1);
    // No timer advance: the dismissal must come from the click itself,
    // not from the auto-dismiss timer.
    expect(screen.queryByText('Reposted')).not.toBeInTheDocument();
  });

  it('should auto-dismiss and remove the toast after its full lifetime', () => {
    renderWithToast({ title: 'Ephemeral' });

    expect(screen.getByText('Ephemeral')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(FULL_TOAST_LIFETIME);
    });
    expect(screen.queryByText('Ephemeral')).not.toBeInTheDocument();
  });
  it('preserves an explicitly empty error title', () => {
    renderWithToast({ variant: 'error', title: '', description: 'Details only' });
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(screen.getByText('Details only')).toBeInTheDocument();
  });

  it('dismisses the old toast before invoking an action that creates a replacement', () => {
    const onClick = vi.fn(() => {
      expect(getSnapshot().toasts[0].open).toBe(false);
      toast({ title: 'Item restored' });
    });
    renderWithToast({
      title: 'Item removed',
      durationMs: 5_000,
      action: { label: 'Undo', altText: 'Restore item to cart', onClick },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Item removed')).not.toBeInTheDocument();
    expect(screen.getByText('Item restored')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION - 1);
    });
    expect(screen.getByText('Item restored')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Item restored')).not.toBeInTheDocument();
  });

  it('keeps the wallet retry toast open beyond Radix default timing and closes it at 60 seconds', () => {
    renderWithToast({
      variant: 'error',
      title: 'Finish wallet setup',
      description: 'Finish setup on your phone, then try again.',
      durationMs: 60_000,
      dismissButton: true,
      action: { label: 'Try again', altText: 'Try again', onClick: vi.fn() },
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(54_999);
    });
    expect(screen.getByText('Finish wallet setup')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Finish wallet setup')).not.toBeInTheDocument();
  });

  it('dismisses a wallet setup toast with OK without retrying', () => {
    const retry = vi.fn();
    renderWithToast({
      variant: 'error',
      title: 'Finish wallet setup',
      durationMs: 60_000,
      dismissButton: true,
      action: { label: 'Try again', altText: 'Try again', onClick: retry },
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.queryByText('Finish wallet setup')).not.toBeInTheDocument();
  });

  it('renders custom actions consistently across toast variants', () => {
    renderWithToast({
      variant: 'error',
      title: 'Try again later',
      action: { label: 'Retry', altText: 'Retry request', onClick: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('bg-toast-action-muted');
  });

  it('allows a persistent notification to be dismissed without waiting for a timer', () => {
    renderWithToast({ title: 'Action required', persistent: true, dismissButton: true });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Action required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('Action required')).not.toBeInTheDocument();
  });
});
