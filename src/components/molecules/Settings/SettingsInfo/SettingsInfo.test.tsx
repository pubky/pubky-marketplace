import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { SettingsInfo } from './SettingsInfo';

vi.mock('@/config/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/app')>()),
  APP_VERSION: '1.2.3',
}));

vi.mock('@/organisms/FeedbackCard/FeedbackCard', () => ({
  FeedbackCard: () => <div data-testid="feedback-card" />,
}));

vi.mock('@/config/externalLinks', () => ({
  APP_RELEASE_URL: 'https://github.com/pubky/pubky-app/releases/tag/1.2.3',
}));

describe('SettingsInfo', () => {
  it('renders without crashing', () => {
    const { container } = render(<SettingsInfo />);
    expect(container).toBeTruthy();
  });

  it('renders all section headers', () => {
    render(<SettingsInfo />);

    expect(screen.getByText('Terms of Service & Privacy')).toBeInTheDocument();
    expect(screen.getByText('FAQ')).toBeInTheDocument();
  });

  it('renders the feedback card', () => {
    render(<SettingsInfo />);
    expect(screen.getByTestId('feedback-card')).toBeInTheDocument();
  });

  it('renders subtitle for Terms section', () => {
    render(<SettingsInfo />);
    expect(screen.getByText('Please read our terms carefully.')).toBeInTheDocument();
  });

  it('renders version section with title and version number', () => {
    render(<SettingsInfo />);
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
  });

  it('renders version link pointing to release URL', () => {
    render(<SettingsInfo />);
    const versionLink = screen.getByText('v1.2.3').closest('a');
    expect(versionLink).toHaveAttribute('href', 'https://github.com/pubky/pubky-app/releases/tag/1.2.3');
    expect(versionLink).toHaveAttribute('target', '_blank');
  });

  it('renders copyright text', () => {
    render(<SettingsInfo />);
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Synonym Software`))).toBeInTheDocument();
  });
});

describe('SettingsInfo in store mode', () => {
  afterEach(() => setStoreSeller(undefined));

  it('asks no feedback and lists only the account FAQ', () => {
    setStoreSeller('s'.repeat(52));
    render(<SettingsInfo />);

    expect(screen.getByText('How can I restore my account?')).toBeInTheDocument();
    expect(screen.queryByText('How can I delete my post?')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-card')).not.toBeInTheDocument();
  });
});
