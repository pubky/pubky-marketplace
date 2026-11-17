import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatContextChip } from './ChatContextChip';

const commerce = vi.hoisted(() => ({ mode: 'transaction-service' }));
vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => commerce.mode,
}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => ({ owner: 's'.repeat(52), title: 'Leather boots' }) }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'b'.repeat(52) }),
}));

const context = { listingId: 'boots-1', orderId: 'ord_8f2c1a9e7b3d' };

describe('ChatContextChip', () => {
  afterEach(() => {
    commerce.mode = 'transaction-service';
  });

  it('links the listing and the order when commerce is on', () => {
    render(<ChatContextChip context={context} peerPubky={'s'.repeat(52)} />);

    expect(screen.getByRole('link', { name: 'Leather boots' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Order ord_8f2c' })).toBeInTheDocument();
  });

  it('keeps the listing and order as plain labels when commerce is unavailable', () => {
    commerce.mode = 'unavailable';
    render(<ChatContextChip context={context} peerPubky={'s'.repeat(52)} />);

    expect(screen.getByText('Leather boots')).toBeInTheDocument();
    expect(screen.getByText('Order ord_8f2c')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
