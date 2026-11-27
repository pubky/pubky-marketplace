import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setStoreStateForTests } from '@/config/store-mode';
import { setBasePath } from '@/test-utils/base-path';
import { setSocialHost } from '@/test-utils/social-host';
import RootPage, { generateMetadata } from './page';

describe('root page', () => {
  afterEach(() => {
    setSocialHost(undefined);
    setStoreStateForTests(undefined);
    setBasePath('');
  });

  it.each([undefined, 'https://pubky.app'])('temporarily redirects to Market with social host %s', (socialHost) => {
    setSocialHost(socialHost);
    setStoreStateForTests({ kind: 'off' });

    expect(() => RootPage()).toThrowError(
      expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/marketplace;307;' }),
    );
  });

  it('renders only the holding content while unclaimed, with a base-path-aware setup link', () => {
    setStoreStateForTests({ kind: 'unclaimed', claimMode: true });
    setBasePath('/shop');

    const { container } = render(<RootPage />);

    expect(screen.getByRole('heading', { name: 'This shop is being set up' })).toBeInTheDocument();
    expect(
      screen.getByText('The owner has not finished setting up this shop yet. Please check back soon.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Merchant setup' })).toHaveAttribute('href', '/shop/setup');
    expect(container.querySelector('header, footer, nav, form, script[type="application/ld+json"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    expect(generateMetadata().robots).toEqual({ index: false, follow: false });
  });

  it('keeps redirecting a claimed store', () => {
    setStoreStateForTests({ kind: 'claimed', seller: 'o'.repeat(52), source: 'claim', claimMode: true });
    expect(() => RootPage()).toThrowError(
      expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/marketplace;307;' }),
    );
  });
});
