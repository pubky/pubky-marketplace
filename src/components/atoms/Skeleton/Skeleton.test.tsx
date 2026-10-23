import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders with default props', () => {
    render(<Skeleton data-testid="skeleton" />);
    const skeleton = screen.getByTestId('skeleton');

    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('data-slot', 'skeleton');
  });
});

describe('Skeleton - Rendering', () => {
  it('applies the base classes by default', () => {
    render(<Skeleton data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveClass('animate-pulse', 'rounded-md', 'bg-muted');
  });

  it('merges a custom className with the base classes', () => {
    render(<Skeleton data-testid="skeleton" className="h-4 w-24 rounded-full" />);
    expect(screen.getByTestId('skeleton')).toHaveClass('animate-pulse', 'h-4', 'w-24', 'rounded-full');
  });
});
