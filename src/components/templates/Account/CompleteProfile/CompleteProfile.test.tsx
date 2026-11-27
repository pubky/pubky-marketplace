import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getSocialHostUrl } from '@/config/social';
import { CompleteProfile } from './CompleteProfile';

it('opens the Pubky App sign-in in the top frame and lets the user recheck their profile', () => {
  const location = Object.getOwnPropertyDescriptor(window, 'location')!;
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  try {
    render(<CompleteProfile />);
    const open = screen.getByRole('link', { name: 'Open Pubky App' });
    expect(open).toHaveAttribute('href', getSocialHostUrl('/sign-in'));
    expect(open).toHaveAttribute('target', '_top');
    fireEvent.click(screen.getByRole('button', { name: 'Check for my profile' }));
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(window, 'location', location);
  }
});
