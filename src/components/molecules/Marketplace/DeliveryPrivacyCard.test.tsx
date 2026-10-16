import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SellerDeliveryKeyStatus } from '@/application/commerce/delivery-keys';
import { DeliveryPrivacyCard, type DeliveryPrivacyCardProps } from './DeliveryPrivacyCard';

const KEY_ID = '0123456789abcdef0123456789abcdef';
const local = { keyId: KEY_ID, publicKey: new Uint8Array(32), createdAt: '2026-10-12T10:00:00.000Z', current: true };

function renderCard(status: SellerDeliveryKeyStatus | null, overrides: Partial<DeliveryPrivacyCardProps> = {}) {
  const props: DeliveryPrivacyCardProps = {
    status,
    isWorking: false,
    loadFailed: false,
    onCreate: vi.fn(async () => true),
    onPublish: vi.fn(async () => true),
    ...overrides,
  };
  render(<DeliveryPrivacyCard {...props} />);
  return props;
}

describe('DeliveryPrivacyCard', () => {
  it('explains device custody before creating the first key', async () => {
    const props = renderCard({ local: null, publication: 'missing', publishedKeyId: null });
    await userEvent.click(screen.getByRole('button', { name: 'Create delivery key' }));
    expect(await screen.findByText(/private half stays on this device/)).toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
  });

  it('shows the fingerprint and warns about rotation loss and kept keys', async () => {
    renderCard({ local, publication: 'matches', publishedKeyId: KEY_ID });
    expect(screen.getByTestId('delivery-key-fingerprint')).toHaveTextContent('0123 4567 89ab cdef 0123 4567 89ab cdef');
    expect(screen.getByText('Key fingerprint (public, safe to share)')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rotate key' }));
    expect(await screen.findByText(/keeps your earlier keys/)).toBeInTheDocument();
  });

  it('offers to publish a key that only exists on this device', async () => {
    const props = renderCard({ local, publication: 'missing', publishedKeyId: null });
    expect(screen.getByText('Not published')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish key' }));
    expect(props.onPublish).toHaveBeenCalledTimes(1);
  });

  it('says so when a published key is not held by this device', () => {
    renderCard({ local: null, publication: 'different', publishedKeyId: KEY_ID });
    expect(screen.getByText(/this device does not hold it/)).toBeInTheDocument();
  });

  it('surfaces a status load failure', () => {
    renderCard(null, { loadFailed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read your delivery key status');
    expect(screen.getByRole('button', { name: 'Create delivery key' })).toBeDisabled();
  });

  describe('the way back to the listing', () => {
    function CardAfterCreate({ returnTo }: { returnTo: string | null }) {
      const [status, setStatus] = useState<SellerDeliveryKeyStatus>({
        local: null,
        publication: 'missing',
        publishedKeyId: null,
      });
      return (
        <DeliveryPrivacyCard
          status={status}
          isWorking={false}
          loadFailed={false}
          onCreate={async () => {
            setStatus({ local, publication: 'matches', publishedKeyId: KEY_ID });
            return true;
          }}
          onPublish={vi.fn(async () => true)}
          returnTo={returnTo}
        />
      );
    }

    it('offers Back to your listing once the new key is published', async () => {
      render(<CardAfterCreate returnTo="/marketplace/sell" />);
      expect(screen.queryByRole('link', { name: 'Back to your listing' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Create delivery key' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Create key' }));

      const notice = await screen.findByText('Your delivery key is ready');
      expect(notice.closest('[role="status"]')).toHaveAttribute('data-surface', 'delivery-key-return-to-listing');
      expect(screen.getByRole('link', { name: 'Back to your listing' })).toHaveAttribute('href', '/marketplace/sell');
    });

    it('stays hidden after creating a key when the seller did not come from a listing', async () => {
      render(<CardAfterCreate returnTo={null} />);

      await userEvent.click(screen.getByRole('button', { name: 'Create delivery key' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Create key' }));

      expect(await screen.findByText('Published')).toBeInTheDocument();
      expect(screen.queryByText('Your delivery key is ready')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Back to your listing' })).not.toBeInTheDocument();
    });

    it.each([
      ['missing', { local: null, publication: 'missing', publishedKeyId: null }],
      ['invalid', { local: null, publication: 'invalid', publishedKeyId: null }],
      ['unpublished on this device', { local, publication: 'missing', publishedKeyId: null }],
    ] as const)('stays hidden while the key is %s, since the listing still cannot publish', (_label, status) => {
      renderCard(status, { returnTo: '/marketplace/sell' });

      expect(screen.queryByRole('link', { name: 'Back to your listing' })).not.toBeInTheDocument();
    });

    it('is offered when a key published from another device already lets the listing publish', () => {
      renderCard({ local: null, publication: 'different', publishedKeyId: KEY_ID }, { returnTo: '/marketplace/sell' });

      expect(screen.getByRole('link', { name: 'Back to your listing' })).toHaveAttribute('href', '/marketplace/sell');
    });

    it('stays hidden while the status is still unknown', () => {
      renderCard(null, { returnTo: '/marketplace/sell' });

      expect(screen.queryByRole('link', { name: 'Back to your listing' })).not.toBeInTheDocument();
    });
  });
});
