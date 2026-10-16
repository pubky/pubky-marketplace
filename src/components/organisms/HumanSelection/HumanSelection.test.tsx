import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanSelection } from './HumanSelection';

vi.mock('@/molecules/HumanFooter/HumanFooter', () => {
  return {
    HumanFooter: () => <div data-testid="mock-human-footer">Human Footer</div>,
  };
});

vi.mock('@/molecules/HumanSmsCard/HumanSmsCard', () => {
  return {
    HumanSmsCard: () => <div data-testid="mock-sms-card">SMS Verification Card</div>,
  };
});

vi.mock('@/organisms/HumanBitcoinCard/HumanBitcoinCard', () => {
  return {
    HumanBitcoinCard: () => <div data-testid="mock-bitcoin-card">Bitcoin Payment Card</div>,
  };
});

const passport = vi.hoisted(() => ({ isAvailable: false, isPending: false, start: vi.fn() }));

vi.mock('@/hooks/usePassportSignIn/usePassportSignIn', () => ({
  usePassportSignIn: () => passport,
}));

describe('HumanSelection', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    passport.isAvailable = false;
    passport.start.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders both verification cards', () => {
    render(<HumanSelection onClick={() => {}} onInviteCodeClick={() => {}} onDevMode={() => {}} />);

    expect(screen.getByTestId('mock-sms-card')).toBeInTheDocument();
    expect(screen.getByTestId('mock-bitcoin-card')).toBeInTheDocument();
    expect(screen.getByTestId('mock-human-footer')).toBeInTheDocument();
  });

  it('renders invite code link in subtitle', () => {
    render(<HumanSelection onClick={() => {}} onInviteCodeClick={() => {}} onDevMode={() => {}} />);

    expect(screen.getByTestId('invite-code-link')).toBeInTheDocument();
    expect(screen.getByText('invite code.')).toBeInTheDocument();
  });

  it('matches snapshot', () => {
    const { container } = render(
      <HumanSelection onClick={() => {}} onInviteCodeClick={() => {}} onDevMode={() => {}} />,
    );
    expect(container).toMatchSnapshot();
  });

  it('offers Pubky Passport sign-up with Google beside the verification cards', () => {
    passport.isAvailable = true;
    render(<HumanSelection onClick={() => {}} onInviteCodeClick={() => {}} onDevMode={() => {}} />);

    expect(screen.getByText(/Pubky Passport creates your pubky with it/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sign-in-passport-button'));
    expect(passport.start).toHaveBeenCalledTimes(1);
  });

  it('hides the Google option where Pubky Passport is unavailable', () => {
    render(<HumanSelection onClick={() => {}} onInviteCodeClick={() => {}} onDevMode={() => {}} />);

    expect(screen.queryByTestId('sign-in-passport-option')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pubky Passport creates your pubky/)).not.toBeInTheDocument();
  });
});
