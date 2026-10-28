import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders with default props', () => {
    render(<Badge>Default Badge</Badge>);
    const badge = screen.getByText('Default Badge');
    expect(badge).toBeInTheDocument();
  });
});

describe('Badge - Rendering', () => {
  it('applies the default variant classes by default', () => {
    render(<Badge>Default Badge</Badge>);
    const badge = screen.getByText('Default Badge');
    expect(badge).toHaveAttribute('data-slot', 'badge');
    expect(badge).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it.each([
    ['default', ['bg-primary', 'text-primary-foreground']],
    ['secondary', ['bg-secondary', 'text-secondary-foreground']],
    ['destructive', ['bg-destructive/60', 'text-white']],
    ['outline', ['text-foreground', 'bg-background']],
  ] as const)('sets data-variant="%s" with its variant classes', (variant, classes) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    const badge = screen.getByText(variant);
    expect(badge).toHaveAttribute('data-variant', variant);
    expect(badge).toHaveClass(...classes);
  });

  it('renders as a child element when asChild is set', () => {
    render(
      <Badge asChild>
        <a href="/test">Link Badge</a>
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'Link Badge' });
    expect(link).toHaveAttribute('href', '/test');
    expect(link).toHaveAttribute('data-slot', 'badge');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Badge ref={ref}>Badge</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards ref correctly with asChild', () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(
      <Badge asChild>
        <a ref={ref} href="/test">
          Link Badge
        </a>
      </Badge>,
    );
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });

  it('has correct data attributes', () => {
    render(<Badge variant="secondary">Test Badge</Badge>);
    const badge = screen.getByText('Test Badge');
    expect(badge).toHaveAttribute('data-slot', 'badge');
    expect(badge).toHaveAttribute('data-variant', 'secondary');
  });

  it('supports accessibility attributes', () => {
    render(
      <Badge aria-label="Status badge" role="status">
        Active
      </Badge>,
    );
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('aria-label', 'Status badge');
  });

  it('handles focus states correctly', () => {
    render(<Badge tabIndex={0}>Focusable Badge</Badge>);
    const badge = screen.getByText('Focusable Badge');
    expect(badge).toHaveAttribute('tabIndex', '0');
    expect(badge).toHaveClass('focus-visible:border-ring', 'focus-visible:ring-ring/50');
  });

  it('handles hover states correctly', () => {
    render(<Badge variant="default">Hover Badge</Badge>);
    const badge = screen.getByText('Hover Badge');
    expect(badge).toHaveClass('[a&]:hover:bg-primary/90');
  });

  it('handles invalid states correctly', () => {
    render(<Badge aria-invalid="true">Invalid Badge</Badge>);
    const badge = screen.getByText('Invalid Badge');
    expect(badge).toHaveAttribute('aria-invalid', 'true');
    expect(badge).toHaveClass('aria-invalid:ring-destructive/40', 'aria-invalid:border-destructive');
  });

  it('renders with icons correctly', () => {
    render(
      <Badge>
        <span>🎉</span>
        <span>New Feature</span>
      </Badge>,
    );
    expect(screen.getByText('🎉')).toBeInTheDocument();
    expect(screen.getByText('New Feature')).toBeInTheDocument();
  });

  it('handles long text correctly', () => {
    const longText = 'This is a very long badge text that should be handled properly';
    render(<Badge>{longText}</Badge>);
    const badge = screen.getByText(longText);
    expect(badge).toHaveClass('whitespace-nowrap', 'overflow-hidden');
  });

  it('applies all base classes correctly', () => {
    render(<Badge>Base Classes Test</Badge>);
    const badge = screen.getByText('Base Classes Test');
    expect(badge).toHaveClass(
      'inline-flex',
      'items-center',
      'justify-center',
      'rounded-md',
      'border',
      'px-2',
      'py-0.5',
      'text-xs',
      'font-medium',
      'w-fit',
      'whitespace-nowrap',
      'shrink-0',
      'gap-1',
      'border-transparent',
      'transition-[color,box-shadow]',
      'overflow-hidden',
    );
  });
});
