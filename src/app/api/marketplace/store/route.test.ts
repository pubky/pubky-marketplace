// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import { resolveStoreState } from '@/libs/store-state/store-state.server';
import { GET } from './route';

vi.mock('@/libs/store-state/store-state.server', () => ({ resolveStoreState: vi.fn() }));

const SELLER = 'o'.repeat(52);
const PINNED: StoreState = { kind: 'claimed', seller: SELLER, source: 'pinned', claimMode: false };
const request = (path = '/api/marketplace/store') => new NextRequest(new URL(path, 'https://shop.example'));

describe('GET /api/marketplace/store', () => {
  beforeEach(() => {
    vi.mocked(resolveStoreState).mockReset();
  });

  it.each([
    ['neither key', { kind: 'off' } as StoreState, 404],
    ['seller alone', PINNED, 404],
    ['seller plus mode', PINNED, 404],
    ['claim mode unclaimed', { kind: 'unclaimed', claimMode: true } as StoreState, 200],
    ['claim mode claimed', { kind: 'claimed', seller: SELLER, source: 'claim', claimMode: true } as StoreState, 200],
    ['unavailable', { kind: 'unavailable', claimMode: true } as StoreState, 200],
  ])('handles %s', async (_name, state, status) => {
    vi.mocked(resolveStoreState).mockResolvedValue(state);
    const response = await GET(request());
    expect(response.status).toBe(status);
    if (status === 200) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({
        kind: state.kind,
        seller: state.kind === 'claimed' ? state.seller : null,
        source: state.kind === 'claimed' ? state.source : null,
      });
    }
  });

  it('passes fresh to the resolver only when requested', async () => {
    vi.mocked(resolveStoreState).mockResolvedValue({ kind: 'unclaimed', claimMode: true });
    await GET(request('/api/marketplace/store?fresh=1'));
    expect(resolveStoreState).toHaveBeenLastCalledWith({ fresh: true });
    await GET(request());
    expect(resolveStoreState).toHaveBeenLastCalledWith({ fresh: false });
  });
});
