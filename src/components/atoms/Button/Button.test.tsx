import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonVariant } from './Button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Default Button</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-brand/16', 'text-brand');
    expect(button).toHaveAttribute('data-slot', 'button');
    // data-variant is only set when variant prop is explicitly provided
    expect(button).not.toHaveAttribute('data-variant');
  });

  it('renders different variants correctly', () => {
    const { rerender } = render(<Button variant={ButtonVariant.SECONDARY}>Secondary</Button>);
    let button = screen.getByRole('button');
    expect(button).toHaveClass('bg-secondary', 'text-secondary-foreground');

    rerender(<Button variant={ButtonVariant.OUTLINE}>Outline</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-input/30');

    rerender(<Button variant={ButtonVariant.GHOST}>Ghost</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('hover:bg-accent/50');

    rerender(<Button variant={ButtonVariant.BRAND}>Brand</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-brand', 'text-background');

    rerender(<Button variant="destructive">Destructive</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-destructive/60', 'text-destructive-foreground');

    rerender(<Button variant="destructive-soft">Destructive Soft</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-destructive/16', 'text-destructive', 'border-destructive');

    rerender(<Button variant="link">Link</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('text-primary', 'underline-offset-4');

    rerender(<Button variant="dark">Dark</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-neutral-900', 'text-white');

    rerender(<Button variant="dark-outline">Dark Outline</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('bg-transparent');
  });

  it('renders different sizes correctly', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    let button = screen.getByRole('button');
    expect(button).toHaveClass('h-8', 'gap-1.5', 'px-3', 'has-[>svg]:px-3.5', 'text-sm');

    rerender(<Button size="lg">Large</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('h-auto', 'gap-2', 'px-8', 'py-5', 'text-sm', 'font-bold', 'leading-normal');

    rerender(<Button size="icon">Icon</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('size-9');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('renders as child component when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: /link button/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/test');
    expect(link).toHaveAttribute('data-slot', 'button');
  });

  it('overrideDefaults removes all default classes', () => {
    render(
      <Button overrideDefaults className="my-custom-class">
        Override Button
      </Button>,
    );
    const button = screen.getByRole('button');

    // Should only have the custom class
    expect(button).toHaveClass('my-custom-class');

    // Should NOT have default button classes
    expect(button).not.toHaveClass('inline-flex');
    expect(button).not.toHaveClass('bg-brand/16');
    expect(button).not.toHaveClass('rounded-full');
    expect(button).not.toHaveClass('border');
  });

  it('overrideDefaults with no className renders a clean button', () => {
    render(<Button overrideDefaults>Clean Button</Button>);
    const button = screen.getByRole('button');

    // Should not have variant or size classes
    expect(button).not.toHaveClass('bg-brand/16');
    expect(button).not.toHaveClass('h-10');
    expect(button).not.toHaveClass('rounded-full');

    // Should still have data attributes
    expect(button).toHaveAttribute('data-slot', 'button');
  });

  it('overrideDefaults works with multiple custom classes', () => {
    render(
      <Button overrideDefaults className="flex items-center gap-2 bg-red-500 px-4 py-2 text-white">
        Custom Styled Button
      </Button>,
    );
    const button = screen.getByRole('button');

    // Should have all custom classes
    expect(button).toHaveClass('flex', 'items-center', 'gap-2', 'px-4', 'py-2', 'bg-red-500', 'text-white');

    // Should NOT have default button classes
    expect(button).not.toHaveClass('bg-brand/16');
    expect(button).not.toHaveClass('rounded-full');
  });

  it('without overrideDefaults applies default classes normally', () => {
    render(<Button className="custom-class">Normal Button</Button>);
    const button = screen.getByRole('button');

    // Should have both default and custom classes
    expect(button).toHaveClass('custom-class');
    expect(button).toHaveClass('bg-brand/16');
    expect(button).toHaveClass('inline-flex');
    expect(button).toHaveClass('rounded-full');
  });
});
