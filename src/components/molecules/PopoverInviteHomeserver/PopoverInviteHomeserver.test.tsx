import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getEmailLink, getTelegramLink, getTwitterLink } from '@/config/externalLinks';
import { PopoverInviteHomeserver } from './PopoverInviteHomeserver';

vi.mock('@/atoms/Popover/Popover', () => {
  return {
    Popover: ({ children }: { children: React.ReactNode }) => <div data-testid="popover">{children}</div>,
    PopoverTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
      <div data-testid="popover-trigger" data-as-child={asChild}>
        {children}
      </div>
    ),
    PopoverContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="popover-content" className={className}>
        {children}
      </div>
    ),
  };
});

// Mock atoms
vi.mock('@/atoms/Button/Button', () => {
  return {
    Button: ({
      children,
      variant,
      size,
      className,
    }: {
      children: React.ReactNode;
      variant?: string;
      size?: string;
      className?: string;
    }) => (
      <button data-testid={`button-${variant || 'default'}`} data-size={size} className={className}>
        {children}
      </button>
    ),
  };
});

vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="container" className={className}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/atoms/Heading/Heading', () => {
  return {
    Heading: ({
      children,
      level = 1,
      size,
      className,
    }: {
      children: React.ReactNode;
      level?: number;
      size?: string;
      className?: string;
    }) => (
      <div role="heading" aria-level={level} data-testid={`heading-${level}`} data-size={size} className={className}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/atoms/Link/Link', () => {
  return {
    Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
      <a data-testid="link" href={href} className={className}>
        {children}
      </a>
    ),
  };
});

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({ children, size, className }: { children: React.ReactNode; size?: string; className?: string }) => (
      <p data-testid="typography" data-size={size} className={className}>
        {children}
      </p>
    ),
  };
});

describe('PopoverInviteHomeserver', () => {
  it('renders a ghost icon button as the popover trigger', () => {
    render(<PopoverInviteHomeserver />);

    const trigger = screen.getByTestId('popover-trigger');
    const button = screen.getByTestId('button-ghost');
    expect(trigger).toContainElement(button);
    expect(button).toHaveAttribute('data-size', 'icon');
    expect(screen.getByTestId('circle-help-icon')).toBeInTheDocument();
  });

  it('applies the default hover class and merges a custom className', () => {
    const { rerender } = render(<PopoverInviteHomeserver />);
    expect(screen.getByTestId('button-ghost')).toHaveClass('hover:bg-brand/10');

    rerender(<PopoverInviteHomeserver className="custom-homeserver-style" />);
    expect(screen.getByTestId('button-ghost')).toHaveClass('custom-homeserver-style');
  });

  it('renders the invite explanation in the popover content', () => {
    render(<PopoverInviteHomeserver />);

    const content = screen.getByTestId('popover-content');
    expect(content).toContainElement(screen.getByTestId('heading-4'));
    expect(screen.getByTestId('heading-4')).toHaveTextContent("Don't have an invite yet?");
    expect(content).toHaveTextContent('Ask the Pubky team for your invite code');
  });

  it('renders the email, twitter and telegram contact links', () => {
    render(<PopoverInviteHomeserver />);

    const links = screen.getAllByTestId('link');
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      getEmailLink(),
      getTwitterLink(),
      getTelegramLink(),
    ]);
  });
});
