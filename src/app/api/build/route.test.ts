import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only the short commit, uncached', async () => {
    vi.stubEnv('GIT_COMMIT', '7ee0cb6540a3f1d2c4b5a69788899aabbccddeef');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ commit: '7ee0cb6540a3' });
  });

  it('reports unknown when no build commit is set', async () => {
    vi.stubEnv('GIT_COMMIT', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');

    expect(await GET().json()).toEqual({ commit: 'unknown' });
  });
});
