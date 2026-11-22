import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { StoreFooter } from './StoreFooter';

const clipboard = vi.hoisted(() => ({ copy: vi.fn(async () => true) }));

vi.mock('@/hooks/useCopyToClipboard/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: clipboard.copy }),
}));

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

describe('StoreFooter', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    clipboard.copy.mockClear();
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

  it("copies the seller's full pubky", async () => {
    setStoreSeller(SELLER);
    const user = userEvent.setup();
    render(<StoreFooter />);

    await user.click(screen.getByRole('button', { name: /Copy the seller's pubky/ }));

    expect(clipboard.copy).toHaveBeenCalledWith(`pubky${SELLER}`);
  });
});
