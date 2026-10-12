import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDeliveryKeyFingerprint } from '@/libs/commerce/delivery-envelope';
import { MarketplaceDeliveryKeyChangeDialog } from './MarketplaceDeliveryKeyChangeDialog';

const CHANGE = { sellerPubky: 's'.repeat(52), pinnedKeyId: 'a'.repeat(32), currentKeyId: 'b'.repeat(32) };

describe('MarketplaceDeliveryKeyChangeDialog', () => {
  it('renders nothing while no change is pending', () => {
    render(<MarketplaceDeliveryKeyChangeDialog change={null} onDecision={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows both fingerprints and reports the buyer accepting', async () => {
    const onDecision = vi.fn();
    render(<MarketplaceDeliveryKeyChangeDialog change={CHANGE} onDecision={onDecision} />);

    expect(screen.getByText(formatDeliveryKeyFingerprint(CHANGE.pinnedKeyId))).toBeInTheDocument();
    expect(screen.getByText(formatDeliveryKeyFingerprint(CHANGE.currentKeyId))).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /use the new key/i }));

    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it('reports a cancel as declined', async () => {
    const onDecision = vi.fn();
    render(<MarketplaceDeliveryKeyChangeDialog change={CHANGE} onDecision={onDecision} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDecision).toHaveBeenCalledWith(false);
  });
});
