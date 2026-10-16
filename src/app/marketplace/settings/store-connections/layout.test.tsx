import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreConnectionsLayout, { dynamic } from './layout';

const flag = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/config/commerce', () => ({ getStoreConnectionsEnabled: () => flag.enabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('store connections layout', () => {
  beforeEach(() => {
    flag.enabled = false;
  });

  it('renders the page when the switch is on', () => {
    flag.enabled = true;
    render(<StoreConnectionsLayout>store connections page</StoreConnectionsLayout>);
    expect(screen.getByText('store connections page')).toBeInTheDocument();
  });

  it('answers like an unknown page when the switch is off', () => {
    expect(() => StoreConnectionsLayout({ children: 'store connections page' })).toThrow('NEXT_NOT_FOUND');
  });

  it('is rendered per request so the gate is never baked in at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
