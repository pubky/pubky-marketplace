import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PopoverBackup } from './PopoverBackup';

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

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({ children, size, className }: { children: React.ReactNode; size?: string; className?: string }) => (
      <p data-testid="typography" data-size={size} className={className}>
        {children}
      </p>
    ),
  };
});

describe('PopoverBackup', () => {
  it('renders a ghost icon button as the popover trigger', () => {
    render(<PopoverBackup />);

    const trigger = screen.getByTestId('popover-trigger');
    const button = screen.getByTestId('button-ghost');
    expect(trigger).toContainElement(button);
    expect(button).toHaveAttribute('data-size', 'icon');
    expect(screen.getByTestId('circle-help-icon')).toBeInTheDocument();
  });

  it('renders the explanation heading and text in the popover content', () => {
    render(<PopoverBackup />);

    const content = screen.getByTestId('popover-content');
    expect(content).toContainElement(screen.getByTestId('heading-4'));
    expect(screen.getByTestId('heading-4')).toHaveTextContent('Why is this important?');
    expect(screen.getByTestId('typography')).toHaveTextContent(/secret seed for your pubky is like a master password/);
  });

  it('merges a custom className onto the trigger button', () => {
    render(<PopoverBackup className="custom-backup-style" />);

    expect(screen.getByTestId('button-ghost')).toHaveClass('hover:bg-white/10', 'custom-backup-style');
  });
});
