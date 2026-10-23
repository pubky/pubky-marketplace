import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('renders with default props', () => {
    render(<Switch />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeInTheDocument();
  });

  it('handles checked state', () => {
    render(<Switch checked={true} />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toHaveAttribute('data-state', 'checked');
  });

  it('handles unchecked state', () => {
    render(<Switch checked={false} />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toHaveAttribute('data-state', 'unchecked');
  });

  it('handles onCheckedChange callback', () => {
    const handleChange = vi.fn();
    render(<Switch onCheckedChange={handleChange} />);

    const switchElement = screen.getByRole('switch');
    fireEvent.click(switchElement);

    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<Switch disabled />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeDisabled();
  });
});

describe('Switch - Rendering', () => {
  it('applies the base classes', () => {
    render(<Switch />);
    expect(screen.getByRole('switch')).toHaveClass('peer', 'inline-flex', 'h-5', 'w-9', 'rounded-full', 'bg-muted');
  });

  it('renders the thumb element with its base classes', () => {
    render(<Switch />);
    const thumb = screen.getByRole('switch').querySelector('[data-state]');
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveClass('pointer-events-none', 'block', 'size-4', 'rounded-full', 'bg-background');
  });

  it('sets aria-checked alongside data-state', () => {
    render(<Switch checked={true} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('merges a custom className with the base classes', () => {
    render(<Switch className="custom-switch" />);
    expect(screen.getByRole('switch')).toHaveClass('h-5', 'w-9', 'custom-switch');
  });
});
