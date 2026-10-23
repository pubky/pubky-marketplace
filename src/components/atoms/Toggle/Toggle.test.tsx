import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  it('renders with default props', () => {
    render(<Toggle>Toggle</Toggle>);

    const toggle = screen.getByRole('button');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent('Toggle');
  });

  it('applies the default variant and size classes by default', () => {
    render(<Toggle>Toggle</Toggle>);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveClass('inline-flex', 'items-center', 'justify-center', 'rounded-md', 'text-sm');
    expect(toggle).toHaveClass('h-9', 'px-2', 'min-w-9');
    expect(toggle).not.toHaveClass('border');
  });

  it('applies the outline variant classes', () => {
    render(<Toggle variant="outline">Toggle</Toggle>);

    expect(screen.getByRole('button')).toHaveClass('border', 'border-input', 'shadow-sm');
  });

  it.each([
    ['default', ['h-9', 'px-2', 'min-w-9']],
    ['sm', ['h-8', 'px-1.5', 'min-w-8']],
    ['lg', ['h-10', 'px-2.5', 'min-w-10']],
  ] as const)('applies size="%s" classes', (size, classes) => {
    render(<Toggle size={size}>Toggle</Toggle>);

    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it('sets data-state and aria-pressed when pressed', () => {
    render(<Toggle pressed>Toggle</Toggle>);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('data-state', 'on');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets data-state off and aria-pressed false when not pressed', () => {
    render(<Toggle>Toggle</Toggle>);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('data-state', 'off');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('is disabled when disabled', () => {
    render(<Toggle disabled>Toggle</Toggle>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Toggle onClick={handleClick}>Toggle</Toggle>);

    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('merges a custom className with the variant classes', () => {
    render(
      <Toggle variant="outline" size="lg" className="custom-toggle">
        Toggle
      </Toggle>,
    );

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveClass('border', 'h-10', 'custom-toggle');
  });

  it('forwards ref correctly', () => {
    const ref = vi.fn();
    render(<Toggle ref={ref}>Toggle</Toggle>);

    expect(ref).toHaveBeenCalled();
  });
});
