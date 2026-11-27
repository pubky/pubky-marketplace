import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreSecureContextScreen } from './StoreSecureContextScreen';

describe('StoreSecureContextScreen', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('says to open the store over HTTPS instead of offering sign-in', () => {
    render(<StoreSecureContextScreen />);

    expect(screen.getByTestId('store-secure-context-screen')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Open this store over HTTPS' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'This store was opened over an insecure connection, so signing in and paying cannot work here. Open it at its https:// address.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('links to the same page over HTTPS', () => {
    window.history.replaceState(null, '', '/marketplace/shop/abc?tab=all#top');
    render(<StoreSecureContextScreen />);

    const link = screen.getByRole('link', { name: 'Open over HTTPS' });
    const expected = new URL(window.location.href);
    expected.protocol = 'https:';
    expect(link).toHaveAttribute('href', expected.toString());
    expect(link.getAttribute('href')).toMatch(/^https:\/\/[^/]+\/marketplace\/shop\/abc\?tab=all#top$/);
  });
});
