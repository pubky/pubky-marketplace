import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import StoreUnavailablePage from './page';

const runtime = vi.hoisted(() => ({ state: { kind: 'off' } as StoreState }));
vi.mock('@/config/store-mode', () => ({ getStoreState: () => runtime.state }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('StoreUnavailablePage', () => {
  it('answers not found outside an unavailable store', () => {
    runtime.state = { kind: 'off' };
    expect(() => StoreUnavailablePage()).toThrow('NEXT_NOT_FOUND');
  });

  it('renders for an unavailable store', () => {
    runtime.state = { kind: 'unavailable', claimMode: true };
    render(<StoreUnavailablePage />);
    expect(screen.getByRole('heading', { name: 'This shop is temporarily unavailable' })).toBeInTheDocument();
  });
});
