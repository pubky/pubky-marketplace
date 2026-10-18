// @vitest-environment node
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { resolveSentryRelease } from '../../src/libs/build-info/build-info';
import {
  type ExecuteSentryCli,
  parseSentryReleaseArgs,
  planSentryRelease,
  runSentryRelease,
  SENTRY_REPOSITORY,
} from './sentry-release';

const SHA = '2f844c1084c432d8dd6d7e66c320dcaeeb9eb02e';
const PREVIOUS_SHA = '9aa66eff0b1a2c3d4e5f60718293a4b5c6d7e8f9';
const CREDENTIALS = { SENTRY_AUTH_TOKEN: 'sntrys_test', SENTRY_ORG: 'synonym-52', SENTRY_PROJECT: 'pubky-marketplace' };
const DOCKER_CI = { ...CREDENTIALS, NEXT_PUBLIC_APP_VERSION: SHA, GITHUB_ACTIONS: 'true' };
const VERCEL = {
  ...CREDENTIALS,
  VERCEL: '1',
  VERCEL_GIT_COMMIT_SHA: SHA.toUpperCase(),
  VERCEL_URL: 'shop-abc.vercel.app',
};

async function run(argv: string[], env: Record<string, string | undefined>, fail: string[] = []) {
  const executed: string[][] = [];
  const logs: string[] = [];
  const execute: ExecuteSentryCli = async (args) => {
    executed.push(args);
    if (fail.includes(args.slice(0, 2).join(' '))) throw new Error(`Command ${args.join(' ')} failed with exit code 1`);
  };
  const code = await runSentryRelease({ argv, env, execute, log: (message) => logs.push(message) });
  return { code, executed, logs };
}

describe('planSentryRelease', () => {
  it('creates the Docker CI release from the tagged commit, with --auto commits and no deploy', () => {
    expect(planSentryRelease(DOCKER_CI, { deploy: false })).toEqual({
      kind: 'run',
      release: SHA,
      commands: [
        ['releases', 'new', SHA],
        ['releases', 'set-commits', SHA, '--auto', '--ignore-missing'],
        ['releases', 'finalize', SHA],
      ],
    });
  });

  it('names the commit on Vercel and records the deploy under the Sentry environment', () => {
    expect(planSentryRelease({ ...VERCEL, PUBKY_RUNTIME_SENTRY_ENVIRONMENT: 'staging' }, { deploy: true })).toEqual({
      kind: 'run',
      release: SHA,
      commands: [
        ['releases', 'new', SHA],
        ['releases', 'set-commits', SHA, '--commit', `${SENTRY_REPOSITORY}@${SHA}`, '--ignore-missing'],
        ['releases', 'finalize', SHA],
        ['deploys', 'new', '--release', SHA, '--env', 'staging', '--url', 'https://shop-abc.vercel.app'],
      ],
    });
  });

  it('uses the release the build baked in', () => {
    for (const env of [DOCKER_CI, VERCEL, { ...CREDENTIALS, VERCEL: '1', GIT_COMMIT: SHA }]) {
      const plan = planSentryRelease(env, { deploy: false });
      expect(plan).toMatchObject({ kind: 'run', release: resolveSentryRelease(env, packageJson.version) });
    }
  });

  it("starts the commit range at Vercel's previous deployment when it is known", () => {
    const plan = planSentryRelease({ ...VERCEL, VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA }, { deploy: false });
    expect(plan.kind === 'run' && plan.commands[1]).toEqual([
      'releases',
      'set-commits',
      SHA,
      '--commit',
      `${SENTRY_REPOSITORY}@${PREVIOUS_SHA}..${SHA}`,
      '--ignore-missing',
    ]);
  });

  it.each([SHA, 'abc123', ''])('names only the commit when the previous SHA is %j', (previous) => {
    const plan = planSentryRelease({ ...VERCEL, VERCEL_GIT_PREVIOUS_SHA: previous }, { deploy: false });
    expect(plan.kind === 'run' && plan.commands[1][4]).toBe(`${SENTRY_REPOSITORY}@${SHA}`);
  });

  it.each([undefined, '', '  '])('records the deploy as production when the Sentry environment is %j', (value) => {
    const { VERCEL_URL: _url, ...env } = VERCEL;
    const plan = planSentryRelease({ ...env, PUBKY_RUNTIME_SENTRY_ENVIRONMENT: value }, { deploy: true });
    expect(plan.kind === 'run' && plan.commands[3]).toEqual([
      'deploys',
      'new',
      '--release',
      SHA,
      '--env',
      'production',
    ]);
  });

  it.each([undefined, '', ' '])('skips when SENTRY_AUTH_TOKEN is %j', (token) => {
    expect(planSentryRelease({ ...DOCKER_CI, SENTRY_AUTH_TOKEN: token }, { deploy: false })).toEqual({
      kind: 'skip',
      reason: 'SENTRY_AUTH_TOKEN is not set',
    });
  });

  it('refuses to run without the organization and project', () => {
    expect(planSentryRelease({ ...DOCKER_CI, SENTRY_ORG: '', SENTRY_PROJECT: undefined }, { deploy: false })).toEqual({
      kind: 'invalid',
      reason: 'SENTRY_ORG and SENTRY_PROJECT not set',
    });
  });

  it('refuses a release that is not a commit SHA', () => {
    expect(planSentryRelease(CREDENTIALS, { deploy: true })).toEqual({
      kind: 'invalid',
      reason: `the build's release "${packageJson.version}" is not a full commit SHA; set GIT_COMMIT to the deployed commit`,
    });
    expect(planSentryRelease({ ...CREDENTIALS, NEXT_PUBLIC_APP_VERSION: 'v0.6.54' }, { deploy: false })).toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('parseSentryReleaseArgs', () => {
  it('reads the two flags', () => {
    expect(parseSentryReleaseArgs([])).toEqual({ deploy: false, warnOnly: false });
    expect(parseSentryReleaseArgs(['--warn-only', '--deploy'])).toEqual({ deploy: true, warnOnly: true });
  });

  it('rejects anything else', () => {
    expect(() => parseSentryReleaseArgs(['--deploy=production'])).toThrow(/Unknown argument --deploy=production/);
  });
});

describe('runSentryRelease', () => {
  it('runs every step in order and exits 0', async () => {
    const { code, executed, logs } = await run([], DOCKER_CI);
    expect(code).toBe(0);
    expect(executed.map((args) => args.slice(0, 2).join(' '))).toEqual([
      'releases new',
      'releases set-commits',
      'releases finalize',
    ]);
    expect(logs.at(-1)).toBe(`Sentry release ${SHA}: done.`);
  });

  it('skips without running sentry-cli when no token is set, with a CI warning', async () => {
    const { code, executed, logs } = await run([], { ...DOCKER_CI, SENTRY_AUTH_TOKEN: undefined });
    expect(code).toBe(0);
    expect(executed).toEqual([]);
    expect(logs).toEqual(['::warning::Sentry release skipped: SENTRY_AUTH_TOKEN is not set.']);
  });

  it('fails on an invalid configuration, or only warns with --warn-only', async () => {
    expect(await run([], CREDENTIALS)).toMatchObject({ code: 1, executed: [] });
    const warned = await run(['--warn-only'], CREDENTIALS);
    expect(warned).toMatchObject({ code: 0, executed: [] });
    expect(warned.logs[0]).toMatch(/^Sentry release not created: /);
  });

  it('still finalizes and records the deploy when set-commits fails, then fails the run', async () => {
    const { code, executed, logs } = await run(['--deploy'], VERCEL, ['releases set-commits']);
    expect(code).toBe(1);
    expect(executed.map((args) => args.slice(0, 2).join(' '))).toEqual([
      'releases new',
      'releases set-commits',
      'releases finalize',
      'deploys new',
    ]);
    expect(logs).toContain(
      `Sentry release ${SHA}: releases set-commits failed: Command releases set-commits ${SHA} --commit ${SENTRY_REPOSITORY}@${SHA} --ignore-missing failed with exit code 1`,
    );
  });

  it('stops when the release cannot be created', async () => {
    const { code, executed } = await run([], DOCKER_CI, ['releases new']);
    expect(code).toBe(1);
    expect(executed).toHaveLength(1);
  });

  it('reports failures without failing the run under --warn-only', async () => {
    const { code, logs } = await run(['--deploy', '--warn-only'], VERCEL, ['releases set-commits', 'deploys new']);
    expect(code).toBe(0);
    expect(logs.filter((message) => message.includes(' failed: '))).toHaveLength(2);
  });

  it('annotates failures for GitHub Actions', async () => {
    const { logs } = await run([], DOCKER_CI, ['releases finalize']);
    expect(logs).toContain(
      `::error::Sentry release ${SHA}: releases finalize failed: Command releases finalize ${SHA} failed with exit code 1`,
    );
  });

  it('rejects unknown arguments before doing anything', async () => {
    await expect(run(['--dry-run'], DOCKER_CI)).rejects.toThrow(/Unknown argument --dry-run/);
  });
});
