// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import * as sdk from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  putJson: vi.fn(),
  remove: vi.fn(),
  signout: vi.fn(),
  exists: vi.fn(),
  signup: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@synonymdev/pubky', () => ({
  Keypair: {
    random: () => ({ publicKey: { z32: () => 'fixture-seller' } }),
    fromSecret: () => ({ publicKey: { z32: () => 'fixture-seller' } }),
  },
  PublicKey: { from: (key: string) => key },
  Pubky: class {
    publicStorage = { exists: fixtures.exists };
    signer() {
      return {
        signup: fixtures.signup,
        signin: async () => ({
          storage: { putJson: fixtures.putJson, delete: fixtures.remove },
          signout: fixtures.signout,
        }),
      };
    }
  },
}));
vi.mock('../.cursor/skills/marketplace-install-verify/scripts/resolve-deps.mjs', () => ({
  requireOptional: (_get: unknown, name: string) => {
    if (name === '@synonymdev/pubky') return sdk;
    return {
      PubkyAppPostKind: { Short: 'short' },
      PubkySpecsBuilder: class {
        createPost() {
          return {
            meta: { id: 'post', path: '/pub/pubky.app/posts/post' },
            post: { toJson: () => ({ content: 'fixture' }) },
          };
        }
      },
    };
  },
}));

let directory: string;
const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'marketplace-probe-test-'));
  writeFileSync(join(directory, 'fixture.secret'), '11'.repeat(32));
  vi.stubEnv('NEXUS_URL', 'https://nexus.example.test');
  vi.stubGlobal('fetch', fixtures.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fixtures.fetch.mockResolvedValue(new Response('fixture signup token'));
  fixtures.exists.mockResolvedValue(false);
  fixtures.remove.mockResolvedValue(undefined);
  fixtures.signup.mockResolvedValue(undefined);
  fixtures.putJson.mockRejectedValue(new Error('profile write failed'));
});
afterEach(() => {
  process.exitCode = originalExitCode;
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Nexus script cleanup failure precedence', () => {
  it('keeps a failed ingest write when the owned grant also fails to sign out', async () => {
    fixtures.signout.mockRejectedValue(new Error('sensitive SDK signout detail'));
    const error = await import('./probe-nexus-listing-ingest.mjs').catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: 'profile write failed',
      errors: [
        expect.objectContaining({ message: 'profile write failed' }),
        expect.objectContaining({ message: 'Could not end the Nexus listing probe grant session' }),
      ],
    });
    expect(fixtures.signout).toHaveBeenCalledOnce();
    expect(inspect(error)).not.toContain('sensitive SDK');
  });

  it('removes the written profile and keeps the post write failure when signout also fails', async () => {
    fixtures.putJson.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('post write failed'));
    fixtures.signout.mockRejectedValue(new Error('sensitive SDK signout detail'));
    const { runNexusWriteProbe } =
      await import('../.cursor/skills/marketplace-install-verify/scripts/nexus-write-probe.mjs');
    const error = await runNexusWriteProbe({
      get: (name: string) => (name === 'NEXUS_PROBE_SECRET_FILE' ? join(directory, 'fixture.secret') : undefined),
      nexusUrl: 'https://nexus.example.test',
      out: undefined,
      runCommand: vi.fn(),
      record: vi.fn(),
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: 'post write failed',
      errors: [
        expect.objectContaining({ message: 'post write failed' }),
        expect.objectContaining({ message: 'Could not end the Nexus write probe grant session' }),
      ],
    });
    expect(fixtures.remove).toHaveBeenCalledExactlyOnceWith('/pub/pubky.app/profile.json');
    expect(fixtures.signout).toHaveBeenCalledOnce();
    expect(inspect(error)).not.toContain('sensitive SDK');
  });
});
