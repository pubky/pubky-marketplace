import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileHeaderProps } from '@/molecules/MobileHeader/MobileHeader';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceContentLayout } from './MarketplaceContentLayout';

const shellMocks = vi.hoisted(() => ({
  homeLayout: 'columns',
  homeStore: vi.fn(),
  customFeed: vi.fn(),
  viewport: vi.fn(() => false),
  header: vi.fn(),
  footer: vi.fn(),
}));

vi.mock('@/stores/home/home.store', () => ({
  useHomeStore: () => {
    shellMocks.homeStore();
    return { layout: shellMocks.homeLayout };
  },
}));
vi.mock('@/hooks/useCustomFeed/useCustomFeed', () => ({ useCustomFeed: shellMocks.customFeed }));
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
    shellMocks.homeLayout = 'columns';
    shellMocks.customFeed.mockReturnValue(undefined);
  });

  it('renders the existing chrome and content without subscribing to feed layout or viewport hooks', () => {
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
    expect(shellMocks.homeStore).not.toHaveBeenCalled();
    expect(shellMocks.customFeed).not.toHaveBeenCalled();
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

  it.each(['columns', 'wide', 'list', 'visual'])(
    'preserves the existing Market DOM and passed props when the saved feed layout is %s',
    (layout) => {
      shellMocks.homeLayout = layout;
      const previous = render(
        <ContentLayout
          showLeftSidebar={false}
          showRightSidebar={false}
          showLeftMobileButton={false}
          showRightMobileButton={false}
          {...retainedProps}
        >
          <div>Market content</div>
        </ContentLayout>,
      );
      const previousMarkup = previous.container.innerHTML;
      previous.unmount();
      vi.clearAllMocks();

      const current = render(
        <MarketplaceContentLayout {...retainedProps}>
          <div>Market content</div>
        </MarketplaceContentLayout>,
      );

      expect(current.container.innerHTML).toBe(previousMarkup);
      expect(shellMocks.homeStore).not.toHaveBeenCalled();
      expect(shellMocks.customFeed).not.toHaveBeenCalled();
      expect(shellMocks.viewport).not.toHaveBeenCalled();
    },
  );
});
