// Creates the Sentry release of a deployed build, associates its commits, finalizes it and, with --deploy, records
// the deploy. The release is the name the build baked in (resolveSentryRelease); it must be a full commit SHA.
//
//   npx tsx scripts/sentry-release/main.ts [--deploy] [--warn-only]
//
// Env: SENTRY_AUTH_TOKEN (unset = skip), SENTRY_ORG, SENTRY_PROJECT, plus the build's release inputs
// (NEXT_PUBLIC_APP_VERSION, GIT_COMMIT, VERCEL_GIT_COMMIT_SHA). The deploy is recorded under the environment events
// carry: PUBKY_RUNTIME_SENTRY_ENVIRONMENT, else the deployed NODE_ENV.
// --warn-only reports every failure as a warning and exits 0, so Sentry never blocks a Vercel deploy.
import { spawn, type SpawnOptions } from 'node:child_process';
import packageJson from '../../package.json';
import { isFullCommitSha, resolveSentryRelease } from '../../src/libs/build-info/build-info';
import { readSentryEnvironment } from '../../src/libs/runtime-config/runtime-config.schema';

type Env = Record<string, string | undefined>;

/** This repository's name in the Sentry GitHub integration. */
export const SENTRY_REPOSITORY = 'pubky/pubky-marketplace';
const DEPLOYED_NODE_ENV = 'production';
const USAGE = 'Usage: npx tsx scripts/sentry-release/main.ts [--deploy] [--warn-only]';

export type SentryReleaseOptions = { deploy: boolean; warnOnly: boolean };

export type SentryReleasePlan =
  | { kind: 'skip'; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'run'; release: string; commands: string[][] };

export type ExecuteSentryCli = (args: string[]) => Promise<unknown>;

/**
 * Runs sentry-cli with its output inherited. `@sentry/cli`'s own `execute` leaves the child's `error` event
 * unhandled, so a binary that is missing or cannot start would crash the process; here it rejects like any
 * other failed step.
 */
export function createSentryCliExecutor(
  binaryPath: () => string,
  env: NodeJS.ProcessEnv = process.env,
): ExecuteSentryCli {
  return (args) =>
    new Promise<void>((resolve, reject) => {
      const options: SpawnOptions = { env, stdio: ['ignore', 'inherit', 'inherit'] };
      const child = spawn(binaryPath(), args, options);
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code === 0) return resolve();
        const outcome = signal ? `was killed by ${signal}` : `failed with exit code ${code}`;
        reject(new Error(`Command ${args.join(' ')} ${outcome}`));
      });
    });
}

export function parseSentryReleaseArgs(argv: string[]): SentryReleaseOptions {
  const unknown = argv.filter((arg) => arg !== '--deploy' && arg !== '--warn-only');
  if (unknown.length > 0) throw new Error(`Unknown argument ${unknown.join(' ')}. ${USAGE}`);
  return { deploy: argv.includes('--deploy'), warnOnly: argv.includes('--warn-only') };
}

// Vercel CLI uploads carry no git history, so on Vercel the commit is named (with the previous deployment's commit
// as the range start when Vercel provides it). Elsewhere (CI, full-history checkout) --auto finds the range.
function commitArgs(env: Env, release: string): string[] {
  if (env.VERCEL !== '1') return ['--auto', '--ignore-missing'];
  const previous = env.VERCEL_GIT_PREVIOUS_SHA?.trim().toLowerCase();
  const range = previous && isFullCommitSha(previous) && previous !== release ? `${previous}..${release}` : release;
  return ['--commit', `${SENTRY_REPOSITORY}@${range}`, '--ignore-missing'];
}

export function planSentryRelease(env: Env, { deploy }: Pick<SentryReleaseOptions, 'deploy'>): SentryReleasePlan {
  if (!env.SENTRY_AUTH_TOKEN?.trim()) return { kind: 'skip', reason: 'SENTRY_AUTH_TOKEN is not set' };

  const missing = (['SENTRY_ORG', 'SENTRY_PROJECT'] as const).filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { kind: 'invalid', reason: `${missing.join(' and ')} not set` };

  const release = resolveSentryRelease(env, packageJson.version);
  if (!isFullCommitSha(release)) {
    return {
      kind: 'invalid',
      reason: `the build's release "${release}" is not a full commit SHA; set GIT_COMMIT to the deployed commit`,
    };
  }

  const commands = [
    ['releases', 'new', release],
    ['releases', 'set-commits', release, ...commitArgs(env, release)],
    ['releases', 'finalize', release],
  ];
  if (deploy) {
    const command = ['deploys', 'new', '--release', release, '--env', readSentryEnvironment(env) ?? DEPLOYED_NODE_ENV];
    const url = env.VERCEL_URL?.trim();
    if (url) command.push('--url', `https://${url}`);
    commands.push(command);
  }
  return { kind: 'run', release, commands };
}

/** Runs the plan and returns the process exit code. */
export async function runSentryRelease({
  argv,
  env,
  execute,
  log,
}: {
  argv: string[];
  env: Env;
  execute: ExecuteSentryCli;
  log: (message: string) => void;
}): Promise<number> {
  const options = parseSentryReleaseArgs(argv);
  const failureLevel = options.warnOnly ? 'warning' : 'error';
  const annotate = (level: 'warning' | 'error', message: string) =>
    env.GITHUB_ACTIONS === 'true' ? `::${level}::${message}` : message;

  const plan = planSentryRelease(env, options);
  if (plan.kind === 'skip') {
    log(annotate('warning', `Sentry release skipped: ${plan.reason}.`));
    return 0;
  }
  if (plan.kind === 'invalid') {
    log(annotate(failureLevel, `Sentry release not created: ${plan.reason}.`));
    return options.warnOnly ? 0 : 1;
  }

  const failed: string[] = [];
  for (const command of plan.commands) {
    const step = command.slice(0, 2).join(' ');
    log(`Sentry release ${plan.release}: ${step}`);
    try {
      await execute(command);
    } catch (error) {
      failed.push(step);
      const detail = error instanceof Error ? error.message : String(error);
      log(annotate(failureLevel, `Sentry release ${plan.release}: ${step} failed: ${detail}`));
      if (step === 'releases new') break;
    }
  }

  if (failed.length === 0) {
    log(`Sentry release ${plan.release}: done.`);
    return 0;
  }
  return options.warnOnly ? 0 : 1;
}
