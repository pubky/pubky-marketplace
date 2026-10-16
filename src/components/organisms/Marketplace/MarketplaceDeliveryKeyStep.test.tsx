import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { MarketplaceDeliveryKeyStep } from './MarketplaceDeliveryKeyStep';

const keyState = vi.hoisted(() => ({
  enabled: true,
  isLoading: false,
  loadFailed: false,
  status: null as { publication: string; local: unknown; publishedKeyId: string | null } | null,
}));

vi.mock('@/hooks/useMyDeliveryKey/useMyDeliveryKey', () => ({
  useMyDeliveryKey: () => ({ ...keyState, isWorking: false, create: vi.fn(), publish: vi.fn() }),
}));

describe('MarketplaceDeliveryKeyStep', () => {
  beforeEach(() => {
    keyState.enabled = true;
    keyState.isLoading = false;
    keyState.loadFailed = false;
    keyState.status = { publication: 'missing', local: null, publishedKeyId: null };
  });

  it('shows Create delivery key as an open step while no key is published', () => {
    render(<MarketplaceDeliveryKeyStep />);

    expect(screen.getByTestId('delivery-key-step-status')).toHaveTextContent('Not created');
    expect(screen.getByRole('link', { name: 'Create delivery key' })).toHaveAttribute(
      'href',
      MARKETPLACE_ROUTES.SETTINGS_SHIPPING,
    );
    expect(screen.getByText(/listings that ship cannot be published/)).toBeInTheDocument();
  });

  it('treats a key published from another device as done and links to manage it', () => {
    keyState.status = { publication: 'different', local: null, publishedKeyId: 'k'.repeat(32) };
    render(<MarketplaceDeliveryKeyStep />);

    expect(screen.getByTestId('delivery-key-step-status')).toHaveTextContent('Published');
    expect(screen.getByRole('link', { name: 'Manage in Shipping settings' })).toHaveAttribute(
      'href',
      MARKETPLACE_ROUTES.SETTINGS_SHIPPING,
    );
    expect(screen.queryByText(/cannot be published/)).not.toBeInTheDocument();
  });

  it('keeps the way back to the listing when Payment settings was opened from one', () => {
    render(<MarketplaceDeliveryKeyStep returnTo={MARKETPLACE_ROUTES.SELL} />);

    expect(screen.getByRole('link', { name: 'Create delivery key' })).toHaveAttribute(
      'href',
      `${MARKETPLACE_ROUTES.SETTINGS_SHIPPING}?returnTo=${encodeURIComponent(MARKETPLACE_ROUTES.SELL)}`,
    );
  });

  it('shows no verdict while the key is being checked', () => {
    keyState.isLoading = true;
    keyState.status = null;
    render(<MarketplaceDeliveryKeyStep />);

    expect(screen.queryByTestId('delivery-key-step-status')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says the status could not be read instead of claiming the key is missing', () => {
    keyState.loadFailed = true;
    keyState.status = null;
    render(<MarketplaceDeliveryKeyStep />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not read your delivery key status');
    expect(screen.queryByTestId('delivery-key-step-status')).not.toBeInTheDocument();
  });

  it('renders nothing outside durable commerce', () => {
    keyState.enabled = false;
    const { container } = render(<MarketplaceDeliveryKeyStep />);

    expect(container).toBeEmptyDOMElement();
  });
});
