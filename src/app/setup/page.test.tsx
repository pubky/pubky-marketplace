import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import SetupPage from './page';

const runtime = vi.hoisted(() => ({ state: { kind: 'off' } as StoreState }));
vi.mock('@/config/store-mode', () => ({ getStoreState: () => runtime.state }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const SELLER = 'o'.repeat(52);

describe('SetupPage gating', () => {
  beforeEach(() => {
    runtime.state = { kind: 'off' };
  });

  it.each([
    ['neither key', { kind: 'off' } as StoreState],
    ['seller alone', { kind: 'claimed', seller: SELLER, source: 'pinned', claimMode: false } as StoreState],
    ['seller plus mode', { kind: 'claimed', seller: SELLER, source: 'pinned', claimMode: false } as StoreState],
  ])('answers not found for %s', (_name, state) => {
    runtime.state = state;
    expect(() => SetupPage()).toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    { kind: 'unclaimed', claimMode: true } as StoreState,
    { kind: 'claimed', seller: SELLER, source: 'claim', claimMode: true } as StoreState,
  ])('renders the setup placeholder for $kind', (state) => {
    runtime.state = state;
    render(<SetupPage />);
    expect(screen.getByRole('heading', { name: 'Shop setup' })).toBeInTheDocument();
  });
});
