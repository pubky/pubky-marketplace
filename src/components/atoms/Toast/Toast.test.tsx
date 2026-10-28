import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from './Toast';
import type { ToastVariant } from './Toast.variants';

function renderToast(variant: ToastVariant = 'default') {
  return render(
    <ToastProvider>
      <Toast variant={variant} open>
        Toast content
      </Toast>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe('Toast Components', () => {
  it('should handle Toast component imports without errors', () => {
    // This test ensures all components can be imported and used
    expect(Toast).toBeDefined();
    expect(ToastAction).toBeDefined();
    expect(ToastProvider).toBeDefined();
    expect(ToastViewport).toBeDefined();
  });

  it('sets data-variant and the default variant classes by default', () => {
    const { container } = renderToast();
    const toast = container.querySelector('[data-variant="default"]');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveClass('border-brand/32', 'bg-brand/8');
  });

  it.each([
    ['default', ['border-brand/32', 'bg-brand/8']],
    ['error', ['border-destructive/32', 'bg-destructive/8']],
    ['warning', ['border-yellow-500/32', 'bg-yellow-500/8']],
    ['info', ['border-accent/32', 'bg-accent/8']],
  ] as const)('sets data-variant="%s" with its variant classes', (variant, classes) => {
    const { container } = renderToast(variant);
    const toast = container.querySelector(`[data-variant="${variant}"]`);
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveClass(...classes);
  });

  it('renders the viewport with its positioning classes', () => {
    const { container } = renderToast();
    const viewport = container.querySelector('ol');
    expect(viewport).toHaveClass('fixed', 'bottom-16', 'left-1/2', 'z-[100]', 'flex-col-reverse');
  });

  it('renders the toast content inside the viewport', () => {
    renderToast();
    expect(screen.getByText('Toast content')).toBeInTheDocument();
  });
});

describe('ToastAction', () => {
  it.each([
    ['default', ['border-brand', 'bg-brand/16', 'text-brand']],
    ['error', ['bg-toast-action-muted', 'text-foreground']],
    ['warning', ['bg-toast-action-muted', 'text-foreground']],
    ['info', ['bg-toast-action-muted', 'text-foreground']],
  ] as const)('applies variant="%s" classes', (variant, classes) => {
    render(
      <ToastProvider>
        <Toast variant={variant} open>
          <ToastAction altText="OK" variant={variant}>
            OK
          </ToastAction>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass(...classes);
  });
});

describe('ToastTitle and ToastDescription', () => {
  it('renders the title with its base classes', () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastTitle>Title text</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.getByText('Title text')).toHaveClass('text-sm', 'font-bold', 'text-popover-foreground');
  });

  it('renders the description with its base classes', () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastDescription>Description text</ToastDescription>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.getByText('Description text')).toHaveClass('text-sm', 'text-popover-foreground');
  });

  it('renders a close button', () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
