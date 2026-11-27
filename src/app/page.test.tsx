import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoreStateForTests } from '@/config/store-mode';
import { setBasePath } from '@/test-utils/base-path';
import { setSocialHost } from '@/test-utils/social-host';
import RootPage, { generateMetadata } from './page';

vi.mock('@/libs/runtime-config/render-mode', () => ({ renderPerRequestOutsideVercel: vi.fn() }));
vi.mock('@/libs/store-state/store-state.server', async () => {
  const { getStoreState } = await import('@/config/store-mode');
  return { resolveStoreState: async () => getStoreState() };
});

describe('root page', () => {
  afterEach(() => {
    setSocialHost(undefined);
    setStoreStateForTests(undefined);
    setBasePath('');
  });

  it.each([undefined, 'https://pubky.app'])(
    'temporarily redirects to Market with social host %s',
    async (socialHost) => {
      setSocialHost(socialHost);
      setStoreStateForTests({ kind: 'off' });

      await expect(RootPage()).rejects.toThrowError(
        expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/marketplace;307;' }),
      );
    },
  );

  it('renders only the holding content while unclaimed, with a base-path-aware setup link', async () => {
    setStoreStateForTests({ kind: 'unclaimed', claimMode: true });
    setBasePath('/shop');

    const { container } = render(await RootPage());

    expect(screen.getByRole('heading', { name: 'This shop is being set up' })).toBeInTheDocument();
    expect(
      screen.getByText('The owner has not finished setting up this shop yet. Please check back soon.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Merchant setup' })).toHaveAttribute('href', '/shop/setup');
    expect(container.querySelector('header, footer, nav, form, script[type="application/ld+json"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });

  it('keeps redirecting a claimed store', async () => {
    setStoreStateForTests({ kind: 'claimed', seller: 'o'.repeat(52), source: 'claim', claimMode: true });
    await expect(RootPage()).rejects.toThrowError(
      expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/marketplace;307;' }),
    );
  });
});
