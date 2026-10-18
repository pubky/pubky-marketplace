// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = '2f844c1084c432d8dd6d7e66c320dcaeeb9eb02e';
const RELEASE_ENV = {
  SENTRY_AUTH_TOKEN: 'sntrys_test',
  SENTRY_ORG: 'synonym-52',
  SENTRY_PROJECT: 'pubky-marketplace',
  NEXT_PUBLIC_APP_VERSION: SHA,
  SENTRY_BINARY_PATH: '/nonexistent/sentry-cli',
};

/** Runs the real entry point the way `vercel.json` and the Docker workflow do. */
function runMain(argv: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/sentry-release/main.ts', ...argv], {
    cwd: REPO_ROOT,
    env: { NODE_ENV: 'production', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('sentry-release entry point', () => {
  it('exits 0 with a warning under --warn-only when sentry-cli cannot be spawned', () => {
    const { status, output } = runMain(['--deploy', '--warn-only'], RELEASE_ENV);
    expect(output).toContain(`Sentry release ${SHA}: releases new failed: spawn /nonexistent/sentry-cli ENOENT`);
    expect(status).toBe(0);
  });

  it('fails without --warn-only when sentry-cli cannot be spawned', () => {
    const { status, output } = runMain([], RELEASE_ENV);
    expect(output).toContain('spawn /nonexistent/sentry-cli ENOENT');
    expect(status).toBe(1);
  });

  it('exits 0 with a warning under --warn-only when it throws before running', () => {
    const { status, output } = runMain(['--warn-only', '--bogus'], RELEASE_ENV);
    expect(output).toContain('Sentry release failed: Unknown argument --bogus.');
    expect(status).toBe(0);
  });

  it('annotates the warning for GitHub Actions', () => {
    const { output } = runMain(['--warn-only', '--bogus'], { ...RELEASE_ENV, GITHUB_ACTIONS: 'true' });
    expect(output).toContain('::warning::Sentry release failed: Unknown argument --bogus.');
  });

  it('fails on the same throw without --warn-only', () => {
    const { status, output } = runMain(['--bogus'], RELEASE_ENV);
    expect(output).toContain('Sentry release failed: Unknown argument --bogus.');
    expect(status).toBe(1);
  });
});
