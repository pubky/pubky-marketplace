import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Search } from './Search';

const { mockUseIsMobile, mockUseSearchTags } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
  mockUseSearchTags: vi.fn(() => ['pubky']),
}));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock('@/hooks/useSearchStreamId/useSearchStreamId', () => ({
  useSearchTags: () => mockUseSearchTags(),
}));

vi.mock('@/organisms/SearchInput/SearchInput', () => ({
  SearchInput: ({ autoFocus }: { autoFocus?: boolean }) => (
    <div data-auto-focus={String(Boolean(autoFocus))} data-testid="search-input">
      SearchInput
    </div>
  ),
}));

vi.mock('@/organisms/Timeline/Feed/TimelineFeed/TimelineFeed', () => ({
  TimelineFeed: ({ variant }: { variant: string }) => (
    <div data-testid="timeline-feed" data-variant={variant}>
      TimelineFeed
    </div>
  ),
}));

vi.mock('@/molecules/SearchEmptyState/SearchEmptyState', () => ({
  SearchEmptyState: () => <div data-testid="search-empty-state">SearchEmptyState</div>,
}));

vi.mock('@/molecules/SearchHeader/SearchHeader', () => ({
  SearchHeader: () => <div data-testid="search-header">SearchHeader</div>,
}));

vi.mock('@/atoms/Container/Container', () => ({
  Container: ({
    children,
    overrideDefaults: _overrideDefaults,
    ...props
  }: {
    children: React.ReactNode;
    overrideDefaults?: boolean;
    [key: string]: unknown;
  }) => (
    <div data-testid="container" {...props}>
      {children}
    </div>
  ),
}));

describe('Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
    mockUseSearchTags.mockReturnValue(['pubky']);
  });

  it('renders TimelineFeed with SEARCH variant when tags are present', () => {
    render(<Search />);

    const timelineFeed = screen.getByTestId('timeline-feed');
    expect(timelineFeed).toBeInTheDocument();
    expect(timelineFeed).toHaveAttribute('data-variant', 'search');
  });

  it('renders search results header when tags are present', () => {
    render(<Search />);

    expect(screen.getByTestId('search-header')).toBeInTheDocument();
    expect(screen.queryByTestId('search-empty-state')).not.toBeInTheDocument();
  });

  it('renders the empty state when no tags are present', () => {
    mockUseSearchTags.mockReturnValue([]);

    render(<Search />);

    expect(screen.getByTestId('search-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-feed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-header')).not.toBeInTheDocument();
  });

  it.each([
    { isMobile: false, tags: ['pubky'], autoFocus: 'false' },
    { isMobile: false, tags: [], autoFocus: 'true' },
    { isMobile: true, tags: ['pubky'], autoFocus: 'true' },
  ])(
    'renders the SearchInput with autoFocus=$autoFocus when isMobile=$isMobile and tags=$tags',
    ({ isMobile, tags, autoFocus }) => {
      mockUseIsMobile.mockReturnValue(isMobile);
      mockUseSearchTags.mockReturnValue(tags);

      render(<Search />);

      expect(screen.getByTestId('search-input')).toHaveAttribute('data-auto-focus', autoFocus);
    },
  );

  it('does not render a ContentLayout shell (hoisted into (feeds)/layout.tsx)', () => {
    render(<Search />);
    expect(screen.queryByTestId('content-layout')).not.toBeInTheDocument();
  });

  it('does not render DialogWelcome (removed as stray import)', () => {
    render(<Search />);
    expect(screen.queryByTestId('dialog-welcome')).not.toBeInTheDocument();
  });
});
