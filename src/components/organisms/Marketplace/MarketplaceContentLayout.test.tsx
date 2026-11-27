import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileHeaderProps } from '@/molecules/MobileHeader/MobileHeader';
import { MarketplaceContentLayout } from './MarketplaceContentLayout';

const shellMocks = vi.hoisted(() => ({
  viewport: vi.fn(() => false),
  header: vi.fn(),
  footer: vi.fn(),
}));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({ useIsMobile: shellMocks.viewport }));

// Test the layout's chrome contract separately from the real mobile chrome's
// own tests and the Market app-shell visual regression scenes.
vi.mock('@/molecules/MobileHeader/MobileHeader', () => ({
  MobileHeader: (props: MobileHeaderProps) => {
    shellMocks.header(props);
    return (
      <header
        data-testid="mobile-header"
        data-left-button={props.showLeftButton}
        data-right-button={props.showRightButton}
        data-gradient={props.hasGradientBackground}
      />
    );
  },
}));
vi.mock('@/molecules/MobileFooter/MobileFooter', () => ({
  MobileFooter: () => {
    shellMocks.footer();
    return <footer data-testid="mobile-footer" />;
  },
}));

const retainedProps = {
  className: 'marketplace-surface pb-28 font-medium lg:pb-16',
  classNameWrapperContent: 'max-w-4xl',
  hasGradientBackground: false,
  disableMainContentOverflow: true,
} satisfies Omit<ComponentProps<typeof MarketplaceContentLayout>, 'children'>;

describe('MarketplaceContentLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the existing chrome and content without subscribing to viewport changes', () => {
    render(<MarketplaceContentLayout>Market content</MarketplaceContentLayout>);

    expect(screen.getByText('Market content')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-footer')).toBeInTheDocument();
    expect(shellMocks.header).toHaveBeenCalledWith({
      showLeftButton: false,
      showRightButton: false,
      hasGradientBackground: undefined,
    });
    expect(shellMocks.footer).toHaveBeenCalled();
    expect(shellMocks.viewport).not.toHaveBeenCalled();
  });

  it('keeps page overflow constrained by default and allows sticky-page overrides', () => {
    const { rerender } = render(<MarketplaceContentLayout>Market content</MarketplaceContentLayout>);
    const content = screen.getByText('Market content');
    expect(content).toHaveClass('lg:overflow-hidden');

    rerender(
      <MarketplaceContentLayout disableMainContentOverflow classNameWrapperContent="overflow-visible">
        Market content
      </MarketplaceContentLayout>,
    );
    expect(screen.getByText('Market content')).not.toHaveClass('lg:overflow-hidden');
    expect(screen.getByText('Market content')).toHaveClass('overflow-visible');
  });

  it('applies Market layout overrides without clipping sticky children', () => {
    render(<MarketplaceContentLayout {...retainedProps}>Market content</MarketplaceContentLayout>);
    expect(screen.getByText('Market content')).toHaveClass('max-w-4xl');
    expect(screen.getByText('Market content')).not.toHaveClass('lg:overflow-hidden');
    expect(document.querySelector('.marketplace-surface')).toHaveClass('pb-28');
    expect(shellMocks.header).toHaveBeenCalledWith(expect.objectContaining({ hasGradientBackground: false }));
  });
});
