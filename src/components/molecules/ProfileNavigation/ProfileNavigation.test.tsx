import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileNavigation } from './ProfileNavigation';

describe('ProfileNavigation', () => {
  const defaultProps = {
    continueButtonDisabled: false,
    continueText: 'Finish',
    onContinue: vi.fn(),
  };

  it('renders back and continue buttons with the default texts', () => {
    render(<ProfileNavigation {...defaultProps} />);

    expect(screen.getByRole('button', { name: /back/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /finish/i })).toBeEnabled();
  });

  it('renders custom button texts', () => {
    render(<ProfileNavigation {...defaultProps} continueText="Complete" backText="Previous" />);

    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
  });

  it('marks the continue button with the profile-finish-btn id', () => {
    render(<ProfileNavigation {...defaultProps} />);

    expect(screen.getByRole('button', { name: /finish/i })).toHaveAttribute('id', 'profile-finish-btn');
  });

  it('calls onContinue when the continue button is clicked', () => {
    const onContinue = vi.fn();
    render(<ProfileNavigation {...defaultProps} onContinue={onContinue} />);

    fireEvent.click(screen.getByRole('button', { name: /finish/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls onHandleBackButton when the back button is clicked', () => {
    const onHandleBackButton = vi.fn();
    render(<ProfileNavigation {...defaultProps} onHandleBackButton={onHandleBackButton} />);

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(onHandleBackButton).toHaveBeenCalledTimes(1);
  });

  it('disables the buttons in their disabled states', () => {
    render(<ProfileNavigation {...defaultProps} continueButtonDisabled={true} backButtonDisabled={true} />);

    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /finish/i })).toBeDisabled();
  });

  it('shows a loading spinner instead of the arrow when loading', () => {
    render(<ProfileNavigation {...defaultProps} continueButtonLoading={true} />);

    const continueButton = screen.getByRole('button', { name: /finish/i });
    expect(continueButton.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('hides the continue button when hiddenContinueButton', () => {
    render(<ProfileNavigation {...defaultProps} hiddenContinueButton={true} />);

    expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('hides the back button when hiddenBackButton', () => {
    render(<ProfileNavigation {...defaultProps} hiddenBackButton={true} />);

    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });
});
