import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MarketplaceInventoryGrantDialog } from './MarketplaceInventoryGrantDialog';

vi.mock('./MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: ({ intent, triggerLabel }: { intent: string; triggerLabel: string }) => (
    <div data-testid="marketplace-grant" data-intent={intent}>
      {triggerLabel}
    </div>
  ),
}));
it('routes every inventory approval through the marketplace selling grant', () => {
  render(<MarketplaceInventoryGrantDialog />);
  expect(screen.getByTestId('marketplace-grant')).toHaveAttribute('data-intent', 'sell');
  expect(screen.getByText('Approve in your Pubky signer')).toBeInTheDocument();
});
