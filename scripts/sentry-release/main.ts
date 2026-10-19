// Entry point of scripts/sentry-release. Under --warn-only (the Vercel build) nothing may fail the command: a
// module that fails to load, a binary that cannot start, a bad argument or a crash all end in a warning and exit 0.
// The modules are imported dynamically so that a failed import is handled here too.
import type { ExecuteSentryCli } from './sentry-release';

const argv = process.argv.slice(2);
const warnOnly = argv.includes('--warn-only');

function exitOnFailure(error: unknown): never {
  const level = warnOnly ? 'warning' : 'error';
  const message = `Sentry release failed: ${error instanceof Error ? error.message : String(error)}`;
  console.log(process.env.GITHUB_ACTIONS === 'true' ? `::${level}::${message}` : message);
  process.exit(warnOnly ? 0 : 1);
}

process.on('uncaughtException', exitOnFailure);
process.on('unhandledRejection', exitOnFailure);

async function main(): Promise<number> {
  const [{ default: SentryCli }, { createSentryCliExecutor, runSentryRelease }] = await Promise.all([
    import('@sentry/cli'),
    import('./sentry-release'),
  ]);
  const execute: ExecuteSentryCli = createSentryCliExecutor(() => SentryCli.getPath());
  return runSentryRelease({ argv, env: process.env, execute, log: (message) => console.log(message) });
}

main().then((code) => {
  process.exitCode = code;
}, exitOnFailure);
