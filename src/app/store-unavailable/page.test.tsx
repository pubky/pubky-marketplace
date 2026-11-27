import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import StoreUnavailablePage, { metadata } from './page';

const runtime = vi.hoisted(() => ({ state: { kind: 'off' } as StoreState }));
vi.mock('@/libs/store-state/store-state.server', () => ({ resolveStoreState: async () => runtime.state }));
vi.mock('@/libs/runtime-config/render-mode', () => ({ renderPerRequestOutsideVercel: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('StoreUnavailablePage', () => {
  it('answers not found outside an unavailable store', async () => {
    runtime.state = { kind: 'off' };
    await expect(StoreUnavailablePage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders for an unavailable store', async () => {
    runtime.state = { kind: 'unavailable', claimMode: true };
    render(await StoreUnavailablePage());
    expect(screen.getByRole('heading', { name: 'This shop is temporarily unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Please check back soon.')).toBeInTheDocument();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
