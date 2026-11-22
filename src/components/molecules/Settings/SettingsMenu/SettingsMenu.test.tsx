import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { SettingsMenu } from './SettingsMenu';

describe('SettingsMenu', () => {
  it('renders without crashing', () => {
    const { container } = render(<SettingsMenu />);
    expect(container).toBeTruthy();
  });

  it('renders Settings header', () => {
    render(<SettingsMenu />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders all menu items', () => {
    render(<SettingsMenu />);

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Privacy & Safety')).toBeInTheDocument();
    expect(screen.getByText('Muted Users')).toBeInTheDocument();
    expect(screen.getByText('Help')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Delivery addresses/i })).toHaveAttribute(
      'href',
      '/marketplace/settings/addresses',
    );
  });

  describe('store mode', () => {
    afterEach(() => setStoreSeller(undefined));

    it('leaves out the social settings a store does not serve', () => {
      setStoreSeller('s'.repeat(52));
      render(<SettingsMenu />);

      expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
        '/settings/account',
        '/settings/privacy-safety',
        '/settings/help',
        '/marketplace/settings/addresses',
      ]);
    });
  });
});
