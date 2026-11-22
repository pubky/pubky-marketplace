import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { StoreLogo } from './StoreLogo';

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

const shops = vi.hoisted(() => ({
  local: null as { record: { name: string; avatarUrl?: string } } | null,
  getShop: vi.fn(),
  refreshShop: vi.fn(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: shops.getShop,
    refreshShop: shops.refreshShop,
  },
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', () => ({
  useMarketplaceMediaUrl: (uri: string | null | undefined) => (uri ? `https://media.example/${uri}` : null),
}));

describe('StoreLogo', () => {
  beforeEach(() => {
    setStoreSeller(SELLER);
    shops.local = null;
    shops.getShop.mockImplementation(async () => shops.local);
    shops.refreshShop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    vi.clearAllMocks();
  });

  it("shows the shop's name and avatar from its record and links to the store home", async () => {
    shops.local = { record: { name: 'Example Ceramics', avatarUrl: 'avatar.png' } };
    render(<StoreLogo />);

    const logo = await screen.findByRole('link', { name: 'Example Ceramics' });
    expect(logo).toHaveAttribute('href', `/marketplace/shop/${SELLER}`);
    expect(logo.querySelector('img')).toHaveAttribute('src', 'https://media.example/avatar.png');
    expect(shops.getShop).toHaveBeenCalledWith(SELLER);
    expect(shops.refreshShop).not.toHaveBeenCalled();
  });

  it("reads the store seller's shop from the network when it is not cached, showing Shop meanwhile", async () => {
    render(<StoreLogo noLink />);

    expect(await screen.findByTestId('store-logo')).toHaveTextContent('Shop');
    await waitFor(() => expect(shops.refreshShop).toHaveBeenCalledWith(SELLER));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
