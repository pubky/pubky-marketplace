import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogTerms } from './DialogTerms';

vi.mock('@/atoms/Dialog/Dialog', () => {
  return {
    Dialog: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog">{children}</div>,
    DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="dialog-content" className={className}>
        {children}
      </div>
    ),
    DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="dialog-header" className={className}>
        {children}
      </div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="dialog-title">{children}</h2>,
    DialogTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
      <div data-testid="dialog-trigger" data-as-child={asChild}>
        {children}
      </div>
    ),
  };
});

// Mock atoms
vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="container" className={className}>
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

vi.mock('@/atoms/List/List', () => {
  return {
    List: ({
      children,
      as: Tag = 'ul',
      className,
    }: {
      children: React.ReactNode;
      as?: React.ElementType;
      className?: string;
    }) => (
      <Tag data-testid="list" className={className}>
        {children}
      </Tag>
    ),
  };
});

vi.mock('@/atoms/SidebarButton/SidebarButton', () => {
  return {
    SidebarButton: ({
      children,
      icon: Icon,
    }: {
      children: React.ReactNode;
      icon: React.ComponentType<{ className?: string }>;
    }) => (
      <button data-testid="sidebar-button">
        <Icon data-testid="sidebar-button-icon" />
        <span data-testid="sidebar-button-text">{children}</span>
      </button>
    ),
  };
});

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({
      children,
      as: Tag = 'p',
      className,
    }: {
      children: React.ReactNode;
      as?: React.ElementType;
      className?: string;
    }) => (
      <Tag data-testid="typography" className={className}>
        {children}
      </Tag>
    ),
  };
});

describe('DialogTerms', () => {
  it('renders with default props', () => {
    render(<DialogTerms />);

    const dialog = screen.getByTestId('dialog');
    const trigger = screen.getByTestId('dialog-trigger');
    const content = screen.getByTestId('dialog-content');
    const header = screen.getByTestId('dialog-header');
    const title = screen.getByTestId('dialog-title');

    expect(dialog).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();
    expect(content).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(title).toBeInTheDocument();
  });

  it('renders terms of service content', () => {
    render(<DialogTerms />);

    // Check for some key terms content - use getAllByText for elements that appear multiple times
    expect(screen.getByText(/Thank you for using the Pubky platform/)).toBeInTheDocument();
    expect(screen.getAllByText(/TERMS AND CONDITIONS/)).toHaveLength(2); // Appears twice
    expect(screen.getByText(/Effective Date: October 22, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/PLEASE REVIEW THE ARBITRATION PROVISION/)).toBeInTheDocument();
  });
});

describe('DialogTerms - regional availability', () => {
  it('limits the EU, the UK and the US to commerce features, not the whole Platform', () => {
    const { container } = render(<DialogTerms />);
    const text = container.textContent ?? '';

    expect(text).toMatch(
      /Buying, selling, and paid unlocks of digital content \(together, “commerce features”\) are not available in the European Union \(including each EU Member State\), the United Kingdom, or the United States\./,
    );
    expect(text).toContain(
      'It applies to commerce features only: the rest of the Platform remains available in those places.',
    );
    expect(text).toContain('We reserve the right to restrict access to specific features based on your location.');
  });

  it('keeps Prohibited Jurisdiction to the sanctions list plus Russia and Belarus', () => {
    const { container } = render(<DialogTerms />);
    const definition = Array.from(container.querySelectorAll('li')).find((li) =>
      li.textContent?.startsWith('“Prohibited Jurisdiction” means'),
    );

    expect(definition?.textContent).toBe(
      '“Prohibited Jurisdiction” means any of: Cuba, Democratic People’s Republic of Korea (North Korea), Iran, Syria, Russia, Belarus, Crimea (a region of Ukraine annexed by the Russian Federation), the self-proclaimed Donetsk People’s Republic (a region of Ukraine) and the self-proclaimed Luhansk People’s Republic (a region of Ukraine);',
    );
    expect(container.textContent).toContain(
      'The Platform is not available to users in Prohibited Jurisdictions as defined below.',
    );
    expect(container.textContent).toContain(
      'you agree to not access the Platform from Prohibited Jurisdictions as defined herein.',
    );
  });

  it('describes the Shop without Stripe', () => {
    const { container } = render(<DialogTerms />);
    const text = container.textContent ?? '';

    expect(text).toContain('PUBKY SHOP AND PUBKY MARKETPLACE');
    expect(text).toContain('We are not the PayPal merchant of record for the sale.');
    expect(text).toContain('PayPal, Bitkit, and similar tools are Third-Party Materials.');
    expect(text).not.toMatch(/stripe/i);
  });
});

describe('DialogTerms - Snapshots', () => {
  it('matches snapshot for default DialogTerms', () => {
    const { container } = render(<DialogTerms />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
