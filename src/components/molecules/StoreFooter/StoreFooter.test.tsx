import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { StoreFooter } from './StoreFooter';

const clipboard = vi.hoisted(() => ({ copy: vi.fn(async () => true) }));

vi.mock('@/hooks/useCopyToClipboard/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: clipboard.copy }),
}));

const shops = vi.hoisted(() => ({
  local: null as { record: { name: string } } | null,
  getShop: vi.fn(),
  refreshShop: vi.fn(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: shops.getShop,
    refreshShop: shops.refreshShop,
  },
}));

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

describe('StoreFooter', () => {
  beforeEach(() => {
    shops.local = null;
    shops.getShop.mockImplementation(async () => shops.local);
    shops.refreshShop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    vi.clearAllMocks();
  });

  it('renders nothing in the full Market', () => {
    const { container } = render(<StoreFooter />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names Pubky Market and shows the seller's pubky short, with both ends visible", () => {
    setStoreSeller(SELLER);
    render(<StoreFooter />);

    const footer = screen.getByRole('contentinfo', { name: 'Store' });
    expect(footer).toHaveTextContent('Powered by Pubky Market');
    expect(screen.getByRole('button', { name: `Copy the seller's pubky, pubky${SELLER}` })).toHaveTextContent(
      `pubky${SELLER.slice(0, 8)}...${SELLER.slice(-8)}`,
    );
  });

  it('names the shop from its record as the seller, and links no terms or contact', async () => {
    setStoreSeller(SELLER);
    shops.local = { record: { name: ' Example Ceramics ' } };
    render(<StoreFooter />);

    const footer = screen.getByRole('contentinfo', { name: 'Store' });
    await waitFor(() => expect(footer).toHaveTextContent('Sold by Example Ceramics'));
    expect(footer).toHaveTextContent('Powered by Pubky Market');
    expect(shops.getShop).toHaveBeenCalledWith(SELLER);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says Seller for a seller without a shop record', async () => {
    setStoreSeller(SELLER);
    render(<StoreFooter />);

    await waitFor(() => expect(shops.refreshShop).toHaveBeenCalledWith(SELLER));
    const footer = screen.getByRole('contentinfo', { name: 'Store' });
    expect(footer).toHaveTextContent('Seller');
    expect(footer).not.toHaveTextContent('Sold by');
  });

  it("copies the seller's full pubky", async () => {
    setStoreSeller(SELLER);
    const user = userEvent.setup();
    render(<StoreFooter />);

    await user.click(screen.getByRole('button', { name: /Copy the seller's pubky/ }));

    expect(clipboard.copy).toHaveBeenCalledWith(`pubky${SELLER}`);
  });
});
