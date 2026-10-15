/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const readiness = vi.hoisted(() => vi.fn());
vi.mock('@/server/marketplace-grant/readiness', () => ({ isEmbeddedShopReady: readiness }));

beforeEach(() => {
  readiness.mockReset();
});

describe('GET /api/marketplace/health', () => {
  it('returns a recognizable no-store response without a user session or cookies', async () => {
    readiness.mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: 'pubky-shop-bff', status: 'ready' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it.each(['not-ready', 'probe-failed'])('returns only the generic outage marker when %s', async (failure) => {
    if (failure === 'probe-failed') readiness.mockRejectedValue(new Error('postgres://sensitive-diagnostic'));
    else readiness.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ service: 'pubky-shop-bff', status: 'unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
