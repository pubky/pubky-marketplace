// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = '2f844c1084c432d8dd6d7e66c320dcaeeb9eb02e';
const INFRA_SHA = '9aa66eff0b1a2c3d4e5f60718293a4b5c6d7e8f9';
const BUILD_ENV = {
  SENTRY_AUTH_TOKEN: 'sntrys_test',
  SENTRY_ORG: 'synonym-52',
  SENTRY_PROJECT: 'pubky-marketplace',
  NEXT_PUBLIC_APP_VERSION: SHA,
  GIT_COMMIT: INFRA_SHA,
};

/** Exercise the Docker shell command and real release entry point, replacing only the network-facing CLI. */
function runDockerSentry(env: Record<string, string> = {}, failStep = '') {
  const fixture = mkdtempSync(join(tmpdir(), 'shop-sentry-docker-'));
  try {
    const callsFile = join(fixture, 'calls.jsonl');
    const cli = join(fixture, 'sentry-cli');
    writeFileSync(
      cli,
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS_FILE, JSON.stringify(args) + '\\n');
process.exit(args.slice(0, 2).join(' ') === process.env.TEST_FAIL_STEP ? 7 : 0);
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(fixture, 'npx'),
      `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const [command, ...args] = process.argv.slice(2);
const child = command === 'tsx'
  ? spawnSync(process.execPath, [${JSON.stringify(join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'))}, ...args], { stdio: 'inherit' })
  : command === 'sentry-cli'
    ? spawnSync(process.env.SENTRY_BINARY_PATH, args, { stdio: 'inherit' })
    : null;
process.exit(child?.status ?? 99);
`,
      { mode: 0o700 },
    );

    const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8');
    const block = dockerfile.match(/^RUN if \[ -n "\$SENTRY_AUTH_TOKEN"[^]*?^\s*fi$/m)?.[0];
    if (!block) throw new Error('Docker Sentry credential-gated RUN instruction not found');
    const result = spawnSync('/bin/sh', ['-c', block.replace(/^RUN /, '').replace(/\\\r?\n/g, '')], {
      cwd: REPO_ROOT,
      env: {
        NODE_ENV: 'production',
        PATH: `${fixture}:${process.env.PATH ?? ''}`,
        HOME: fixture,
        ...BUILD_ENV,
        ...env,
        SENTRY_BINARY_PATH: cli,
        TEST_CALLS_FILE: callsFile,
        TEST_FAIL_STEP: failStep,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const calls: string[][] = existsSync(callsFile)
      ? readFileSync(callsFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
    return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('Docker Sentry release and source-map wiring', () => {
  it('associates the Shop build SHA and uploads maps under the same release, without recording a deploy', () => {
    const { status, calls } = runDockerSentry();
    expect(status).toBe(0);
    expect(calls).toEqual([
      ['releases', 'new', SHA],
      ['releases', 'set-commits', SHA, '--commit', `pubky/pubky-marketplace@${SHA}`, '--ignore-missing'],
      ['releases', 'finalize', SHA],
      ['sourcemaps', 'upload', `--release=${SHA}`, '.next'],
    ]);
  });

  it.each(['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'])(
    'keeps public builds offline when %s is absent',
    (name) => {
      const { status, calls, output } = runDockerSentry({ [name]: '' });
      expect(status).toBe(0);
      expect(calls).toEqual([]);
      expect(output).toContain('Skipping Sentry');
    },
  );

  it('rejects a non-commit release before any Sentry operation', () => {
    const { status, calls, output } = runDockerSentry({ NEXT_PUBLIC_APP_VERSION: 'v1.5.0' });
    expect(status).toBe(1);
    expect(calls).toEqual([]);
    expect(output).toContain('not a full commit SHA');
  });

  it.each(['releases new', 'releases set-commits', 'releases finalize'])(
    'fails the image build and does not upload maps when %s fails',
    (step) => {
      const { status, calls } = runDockerSentry({}, step);
      expect(status).toBe(1);
      expect(calls.some((args) => args[0] === 'sourcemaps')).toBe(false);
    },
  );

  it('preserves a source-map upload failure as a failed image build', () => {
    const { status, calls } = runDockerSentry({}, 'sourcemaps upload');
    expect(status).toBe(7);
    expect(calls.at(-1)).toEqual(['sourcemaps', 'upload', `--release=${SHA}`, '.next']);
  });
});
