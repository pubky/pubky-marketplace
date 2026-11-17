// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  fromSecret: vi.fn(),
  mint: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock('@synonymdev/pubky', () => ({
  Keypair: { fromSecret: fixtures.fromSecret },
  Pubky: class {},
}));
vi.mock('./lib/marketplace-grant-session.mjs', () => ({
  mintMarketplaceGrantSessionForSigner: fixtures.mint,
}));

const SERVICE = 'https://marketplace.example.test';
const ID = '11111111-1111-4111-8111-111111111111';
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('MARKETPLACE_SERVICE_URL', SERVICE);
  vi.stubEnv('MARKETPLACE_PROBE_SECRET_HEX', '11'.repeat(32));
  vi.stubEnv('MARKETPLACE_GRANT_CLIENT_ID', 'probe.example.test');
  vi.stubGlobal('fetch', fixtures.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'probe-listing-registration.mjs', 'seller', 'listing'];
  fixtures.fromSecret.mockReturnValue({ publicKey: { z32: () => 'test-identity' } });
  fixtures.mint.mockResolvedValue({ token: 't'.repeat(43), sessionId: ID });
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('listing registration probe', () => {
  it.each(['', 'not-a-secret'])('rejects invalid identity input before any network request', async (secret) => {
    vi.stubEnv('MARKETPLACE_PROBE_SECRET_HEX', secret);
    await expect(import('./probe-listing-registration.mjs')).rejects.toThrow('MARKETPLACE_PROBE_SECRET_HEX');
    expect(fixtures.fromSecret).not.toHaveBeenCalled();
    expect(fixtures.mint).not.toHaveBeenCalled();
    expect(fixtures.fetch).not.toHaveBeenCalled();
  });

  it('uses an existing identity without signup and revokes its bearer after reading the projection', async () => {
    fixtures.fetch
      .mockResolvedValueOnce(Response.json({ listing_id: 'listing' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await import('./probe-listing-registration.mjs');

    expect(fixtures.fromSecret).toHaveBeenCalledWith(new Uint8Array(32).fill(17));
    expect(fixtures.mint).toHaveBeenCalledWith(
      expect.objectContaining({ serviceUrl: SERVICE, clientId: 'probe.example.test' }),
    );
    expect(fixtures.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${SERVICE}/v1/listings/listing%3Aseller_listing`,
      `${SERVICE}/v1/auth/sessions/${ID}`,
    ]);
    expect(fixtures.fetch.mock.calls[1][1]?.method).toBe('DELETE');
    expect(process.exitCode).toBe(0);
  });

  it('revokes its bearer when a projection read fails', async () => {
    fixtures.fetch
      .mockRejectedValueOnce(new Error('projection unavailable'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(import('./probe-listing-registration.mjs')).rejects.toThrow('projection unavailable');

    expect(fixtures.fetch).toHaveBeenLastCalledWith(
      `${SERVICE}/v1/auth/sessions/${ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
  it('preserves projection failure when bearer revocation also fails', async () => {
    fixtures.fetch
      .mockRejectedValueOnce(new Error('projection unavailable'))
      .mockRejectedValueOnce(new Error('sensitive revocation detail'));
    await expect(import('./probe-listing-registration.mjs')).rejects.toMatchObject({
      message: 'projection unavailable',
      errors: [
        expect.objectContaining({ message: 'projection unavailable' }),
        expect.objectContaining({ message: 'Probe service session revocation failed: HTTP unavailable' }),
      ],
    });
    expect(fixtures.fetch).toHaveBeenCalledTimes(2);
  });
});
