import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopProfileCard } from './ShopProfileCard';

describe('ShopProfileCard', () => {
  it('renders the editor preview with a subordinate heading and location', () => {
    render(
      <ShopProfileCard
        variant="mini"
        name="Satoshi Vintage"
        bio="Circular fashion."
        avatarUrl={null}
        bannerUrl={null}
        location={{ countryCode: 'US', region: 'NY' }}
        vacation
        bannerAlt="banner preview"
        avatarAlt="avatar preview"
        testId="shop-live-preview"
      />,
    );

    const preview = screen.getByTestId('shop-live-preview');
    expect(preview).toHaveTextContent('Satoshi Vintage');
    expect(preview).toHaveTextContent('Vacation mode');
    expect(preview).toHaveTextContent('NY, US');
    expect(screen.getByRole('heading', { level: 2, name: 'Satoshi Vintage' })).toBeInTheDocument();
  });

  it('labels the editor preview as a preview and leaves the public storefront unlabeled', () => {
    const props = {
      name: 'Satoshi Vintage',
      bio: 'Circular fashion.',
      avatarUrl: null,
      bannerUrl: null,
      bannerAlt: 'banner',
      avatarAlt: 'avatar',
    };
    const { rerender } = render(<ShopProfileCard variant="mini" {...props} />);

    expect(screen.getByTestId('shop-profile-card-preview-badge')).toHaveTextContent('Preview');
    expect(screen.getByRole('group', { name: 'Storefront preview' })).toBeInTheDocument();

    rerender(<ShopProfileCard variant="full" {...props} />);

    expect(screen.queryByTestId('shop-profile-card-preview-badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Storefront preview' })).not.toBeInTheDocument();
  });

  it('renders the full shop heading level', () => {
    render(
      <ShopProfileCard
        variant="full"
        name="Satoshi Vintage"
        bio="Circular fashion."
        avatarUrl={null}
        bannerUrl={null}
        location={{ countryCode: 'US', region: 'NY' }}
        bannerAlt="banner"
        avatarAlt="avatar"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Satoshi Vintage' })).toBeInTheDocument();
  });
});
