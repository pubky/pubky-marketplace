import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  HomeFeedRightDrawer,
  HomeFeedRightDrawerMobile,
  HomeFeedRightSidebar,
  HotFeedRightDrawer,
  HotFeedRightSidebar,
} from './FeedRightSidebar';

// Mock Molecules
vi.mock('@/molecules/FeedSection/FeedSection', () => {
  return {
    FeedSection: () => <div data-testid="feed-section">FeedSection</div>,
  };
});

// Mock Organisms
vi.mock('@/organisms/ActiveUsers/ActiveUsers', () => {
  return {
    ActiveUsers: () => <div data-testid="active-users">ActiveUsers</div>,
  };
});

vi.mock('@/organisms/FeedbackCard/FeedbackCard', () => {
  return {
    FeedbackCard: () => <div data-testid="feedback-card">FeedbackCard</div>,
  };
});

vi.mock('@/organisms/HotTags/HotTags', () => {
  return {
    HotTags: () => <div data-testid="hot-tags">HotTags</div>,
  };
});

vi.mock('@/organisms/WhoToFollowSidebar/WhoToFollowSidebar', () => {
  return {
    WhoToFollowSidebar: () => <div data-testid="who-to-follow">WhoToFollowSidebar</div>,
  };
});

describe('HomeFeedRightSidebar', () => {
  it('renders all components', () => {
    render(<HomeFeedRightSidebar />);

    expect(screen.getByTestId('who-to-follow')).toBeInTheDocument();
    expect(screen.getByTestId('active-users')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tags')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-card')).toBeInTheDocument();
  });
});

describe('HomeFeedRightDrawer', () => {
  it('renders all components', () => {
    render(<HomeFeedRightDrawer />);

    expect(screen.getByTestId('who-to-follow')).toBeInTheDocument();
    expect(screen.getByTestId('active-users')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tags')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-card')).toBeInTheDocument();
  });
});

describe('HomeFeedRightDrawerMobile', () => {
  it('renders FeedSection', () => {
    render(<HomeFeedRightDrawerMobile />);

    expect(screen.getByTestId('feed-section')).toBeInTheDocument();
  });
});

describe('HotFeedRightSidebar', () => {
  it('renders WhoToFollow and FeedbackCard', () => {
    render(<HotFeedRightSidebar />);

    expect(screen.getByTestId('who-to-follow')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-card')).toBeInTheDocument();
  });
});

describe('HotFeedRightDrawer', () => {
  it('renders WhoToFollow and FeedbackCard', () => {
    render(<HotFeedRightDrawer />);

    expect(screen.getByTestId('who-to-follow')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-card')).toBeInTheDocument();
  });
});
