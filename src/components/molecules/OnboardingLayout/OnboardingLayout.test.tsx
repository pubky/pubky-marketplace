import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OnboardingLayout } from './OnboardingLayout';

describe('OnboardingLayout', () => {
  it('renders children correctly', () => {
    render(
      <OnboardingLayout testId="test-content">
        <div>Test Content</div>
      </OnboardingLayout>,
    );

    expect(screen.getByTestId('test-content')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('renders with navigation when provided', () => {
    render(
      <OnboardingLayout testId="with-nav" navigation={<button>Next</button>}>
        <div>Content</div>
      </OnboardingLayout>,
    );

    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('renders without navigation when not provided', () => {
    const { container } = render(
      <OnboardingLayout testId="no-nav">
        <div>Content</div>
      </OnboardingLayout>,
    );

    const navContainer = container.querySelector('.onboarding-nav');
    expect(navContainer).not.toBeInTheDocument();
  });

  it('keeps navigation close to content when bottom pinning is disabled', () => {
    const { container } = render(
      <OnboardingLayout testId="unpinned-nav" navigation={<button>Next</button>} pinNavigationToBottom={false}>
        <div>Content</div>
      </OnboardingLayout>,
    );

    expect(screen.getByTestId('unpinned-nav')).toHaveClass('flex-none');
    const navContainer = container.querySelector('.onboarding-nav');
    expect(navContainer).toHaveClass('mt-3');
    expect(navContainer).not.toHaveClass('mt-auto');
  });
});
