import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './Breadcrumb';

describe('Breadcrumb', () => {
  describe('Breadcrumb Container', () => {
    it('renders with nav element', () => {
      render(
        <Breadcrumb>
          <BreadcrumbItem>Home</BreadcrumbItem>
        </Breadcrumb>,
      );

      const nav = screen.getByRole('navigation', { name: 'breadcrumb' });
      expect(nav).toBeInTheDocument();
    });

    it('renders with ordered list', () => {
      const { container } = render(
        <Breadcrumb>
          <BreadcrumbItem>Home</BreadcrumbItem>
        </Breadcrumb>,
      );

      const ol = container.querySelector('ol');
      expect(ol).toBeInTheDocument();
    });
  });

  describe('BreadcrumbItem', () => {
    it('renders as list item', () => {
      render(
        <Breadcrumb>
          <BreadcrumbItem>Home</BreadcrumbItem>
        </Breadcrumb>,
      );

      const listItem = screen.getByRole('listitem');
      expect(listItem).toBeInTheDocument();
    });

    it('renders as link when href is provided', () => {
      render(
        <Breadcrumb>
          <BreadcrumbItem href="/home">Home</BreadcrumbItem>
        </Breadcrumb>,
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/home');
    });

    it('renders as button when href is not provided', () => {
      render(
        <Breadcrumb>
          <BreadcrumbItem>Home</BreadcrumbItem>
        </Breadcrumb>,
      );

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('handles click events', () => {
      const handleClick = vi.fn();
      render(
        <Breadcrumb>
          <BreadcrumbItem onClick={handleClick}>Click me</BreadcrumbItem>
        </Breadcrumb>,
      );

      const item = screen.getByRole('listitem');
      fireEvent.click(item);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('truncates long item text with ellipsis classes', () => {
      const longName = 'This is an extremely long profile name that should truncate in the breadcrumb trail';

      render(
        <Breadcrumb>
          <BreadcrumbItem>{longName}</BreadcrumbItem>
        </Breadcrumb>,
      );

      expect(screen.getByText(longName)).toHaveClass('block', 'max-w-full', 'truncate');
    });
  });

  describe('Accessibility', () => {
    it('maintains keyboard navigation', () => {
      const handleClick = vi.fn();
      render(
        <Breadcrumb>
          <BreadcrumbItem onClick={handleClick}>Clickable</BreadcrumbItem>
        </Breadcrumb>,
      );

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();

      // Buttons are keyboard accessible by default
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalled();
    });
  });
});

describe('Breadcrumb - Variants', () => {
  it('uses the md gap by default and the sm gap for size="sm"', () => {
    const { rerender } = render(
      <Breadcrumb className="custom-nav">
        <BreadcrumbItem>Home</BreadcrumbItem>
      </Breadcrumb>,
    );
    expect(screen.getByRole('navigation')).toHaveClass('custom-nav');
    expect(screen.getByRole('list')).toHaveClass('gap-2.5', 'justify-end');

    rerender(
      <Breadcrumb size="sm">
        <BreadcrumbItem>Home</BreadcrumbItem>
      </Breadcrumb>,
    );
    expect(screen.getByRole('list')).toHaveClass('gap-1.5');
    expect(screen.getByRole('list')).not.toHaveClass('gap-2.5');
  });

  it.each([
    { variant: 'link' as const, classes: ['text-muted-foreground', 'cursor-pointer'] },
    { variant: 'current' as const, classes: ['text-foreground'] },
    { variant: 'ellipsis' as const, classes: ['text-muted-foreground'] },
  ])('applies the $variant item variant', ({ variant, classes }) => {
    render(
      <Breadcrumb>
        <BreadcrumbItem variant={variant}>Item</BreadcrumbItem>
      </Breadcrumb>,
    );

    expect(screen.getByRole('listitem')).toHaveClass(...classes);
  });

  it('defaults to the link variant and does not mark the current item as clickable', () => {
    render(
      <Breadcrumb>
        <BreadcrumbItem>Default</BreadcrumbItem>
        <BreadcrumbItem variant="current">Current</BreadcrumbItem>
      </Breadcrumb>,
    );

    const [defaultItem, currentItem] = screen.getAllByRole('listitem');
    expect(defaultItem).toHaveClass('cursor-pointer');
    expect(currentItem).not.toHaveClass('cursor-pointer');
  });

  it('renders a dropdown item as a button with a chevron even when href is set', () => {
    render(
      <Breadcrumb>
        <BreadcrumbItem dropdown href="/ignored">
          Menu
        </BreadcrumbItem>
      </Breadcrumb>,
    );

    expect(screen.getByRole('listitem')).toHaveClass('rounded', 'overflow-hidden');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button.querySelector('svg.lucide-chevron-down')).toBeInTheDocument();
  });

  it('lets an explicit variant win over the dropdown default', () => {
    render(
      <Breadcrumb>
        <BreadcrumbItem dropdown variant="current">
          Menu
        </BreadcrumbItem>
      </Breadcrumb>,
    );

    expect(screen.getByRole('listitem')).toHaveClass('text-foreground');
    expect(screen.getByRole('listitem')).not.toHaveClass('rounded');
  });

  it('renders a hidden separator with the default chevron, size variants and a custom icon', () => {
    const { container, rerender } = render(
      <ol>
        <BreadcrumbSeparator />
      </ol>,
    );
    const separator = container.querySelector('li')!;
    expect(separator).toHaveAttribute('aria-hidden', 'true');
    expect(separator).toHaveAttribute('role', 'presentation');
    expect(separator).toHaveClass('w-4', 'h-4');
    expect(separator.querySelector('svg.lucide-chevron-right')).toBeInTheDocument();

    rerender(
      <ol>
        <BreadcrumbSeparator size="sm" className="custom-separator" icon={<span data-testid="slash">/</span>} />
      </ol>,
    );
    expect(separator).toHaveClass('w-[15px]', 'h-[15px]', 'custom-separator');
    expect(screen.getByTestId('slash')).toBeInTheDocument();
    expect(separator.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
  });

  it('renders the ellipsis as hidden with a screen-reader label', () => {
    const { container } = render(<BreadcrumbEllipsis className="custom-ellipsis" />);

    const ellipsis = container.firstElementChild!;
    expect(ellipsis).toHaveAttribute('aria-hidden', 'true');
    expect(ellipsis).toHaveClass('custom-ellipsis');
    expect(screen.getByText('More')).toHaveClass('sr-only');
  });

  it('marks BreadcrumbPage as the current, disabled page link', () => {
    render(<BreadcrumbPage className="custom-page">Settings</BreadcrumbPage>);

    const page = screen.getByRole('link', { name: 'Settings' });
    expect(page).toHaveAttribute('aria-current', 'page');
    expect(page).toHaveAttribute('aria-disabled', 'true');
    expect(page).toHaveClass('text-foreground', 'custom-page');
  });

  it('renders BreadcrumbLink as an anchor or as its child with asChild', () => {
    const { rerender } = render(<BreadcrumbLink href="/home">Home</BreadcrumbLink>);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveClass('hover:text-foreground');

    rerender(
      <BreadcrumbLink asChild>
        <button type="button">Back</button>
      </BreadcrumbLink>,
    );
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('hover:text-foreground');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders BreadcrumbList as a wrapping ordered list', () => {
    render(<BreadcrumbList className="custom-list" />);

    expect(screen.getByRole('list')).toHaveClass('flex-wrap', 'custom-list');
  });
});
