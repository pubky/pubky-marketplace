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
});
