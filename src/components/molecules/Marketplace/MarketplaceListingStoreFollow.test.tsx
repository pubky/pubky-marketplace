import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarketplaceListingStoreFollow } from './MarketplaceListingStoreFollow';

const props = {
  group: 'price' as const,
  domain: 'demo.myshopify.com',
  editInStoreUrl: 'https://demo.myshopify.com/admin/products/9001',
  saving: false,
  onToggle: vi.fn(),
};

describe('MarketplaceListingStoreFollow', () => {
  it('says the part follows the store, links to the store product and is on', async () => {
    const onToggle = vi.fn();
    render(
      <MarketplaceListingStoreFollow {...props} onToggle={onToggle} state={{ follows: true, overridden: false }} />,
    );

    expect(screen.getByText('Price: follow demo.myshopify.com')).toBeInTheDocument();
    expect(screen.getByText(/Set for the whole connection\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Edit in Shopify/ });
    expect(link).toHaveAttribute('href', props.editInStoreUrl);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    const toggle = screen.getByRole('switch', { name: 'Price follow demo.myshopify.com' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows no store link when the store page is not known', () => {
    render(
      <MarketplaceListingStoreFollow {...props} editInStoreUrl={null} state={{ follows: true, overridden: false }} />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says a part the listing opted out of is not synced, with the switch off', () => {
    render(<MarketplaceListingStoreFollow {...props} state={{ follows: false, overridden: true }} />);

    expect(screen.getByText('Price: not synced with demo.myshopify.com')).toBeInTheDocument();
    expect(screen.getByText(/Set for this listing only\./)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Price follow demo.myshopify.com' })).not.toBeChecked();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('lets a listing opt in for a part the connection leaves alone', async () => {
    const onToggle = vi.fn();
    render(
      <MarketplaceListingStoreFollow {...props} onToggle={onToggle} state={{ follows: false, overridden: false }} />,
    );

    expect(screen.getByText(/Set for the whole connection\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Price follow demo.myshopify.com' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('cannot be switched while a setting is being saved', () => {
    render(<MarketplaceListingStoreFollow {...props} saving state={{ follows: true, overridden: false }} />);

    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
