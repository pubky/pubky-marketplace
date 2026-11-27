import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import SetupPage, { metadata } from './page';

const runtime = vi.hoisted(() => ({ state: { kind: 'off' } as StoreState }));
vi.mock('@/libs/store-state/store-state.server', () => ({ resolveStoreState: async () => runtime.state }));
vi.mock('@/libs/runtime-config/render-mode', () => ({ renderPerRequestOutsideVercel: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/templates/Store/StoreSetup/StoreSetup', () => ({
  StoreSetup: ({ state }: { state: StoreState }) => (
    <div data-testid="store-setup">{state.kind === 'claimed' ? `claimed:${state.seller}` : state.kind}</div>
  ),
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
  ])('answers not found for %s', async (_name, state) => {
    runtime.state = state;
    await expect(SetupPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    { kind: 'unclaimed', claimMode: true } as StoreState,
    { kind: 'claimed', seller: SELLER, source: 'claim', claimMode: true } as StoreState,
  ])('renders setup for $kind', async (state) => {
    runtime.state = state;
    render(await SetupPage());
    expect(screen.getByTestId('store-setup')).toBeInTheDocument();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });
});
