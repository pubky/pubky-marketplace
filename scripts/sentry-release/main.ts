import SentryCli from '@sentry/cli';
import { runSentryRelease } from './sentry-release';

const cli = new SentryCli();

runSentryRelease({
  argv: process.argv.slice(2),
  env: process.env,
  execute: (args) => cli.execute(args, 'rejectOnError'),
  log: (message) => console.log(message),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
