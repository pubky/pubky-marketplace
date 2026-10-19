const COMMIT_UNKNOWN = 'unknown';
const COMMIT_SHORT_LENGTH = 12;
const COMMIT_MIN_LENGTH = 7;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

type CommitEnv = Record<string, string | undefined>;

/**
 * Short git SHA of the running build, or `unknown`.
 *
 * `GIT_COMMIT` is the explicit build input (Docker build arg, or `--env` on a CLI deploy);
 * `VERCEL_GIT_COMMIT_SHA` is what Vercel sets for git-integration deployments. Only a hex SHA is
 * ever returned, so an arbitrary env value can never reach the public response.
 */
export function readBuildCommit(env: CommitEnv = process.env): string {
  for (const raw of [env.GIT_COMMIT, env.VERCEL_GIT_COMMIT_SHA]) {
    const sha = raw?.trim();
    if (sha && sha.length >= COMMIT_MIN_LENGTH && /^[0-9a-f]+$/i.test(sha)) {
      return sha.slice(0, COMMIT_SHORT_LENGTH).toLowerCase();
    }
  }
  return COMMIT_UNKNOWN;
}

export function isFullCommitSha(value: string): boolean {
  return FULL_COMMIT_PATTERN.test(value);
}

/**
 * The Sentry release of a build, baked into it as `NEXT_PUBLIC_APP_VERSION`: the deployed commit's full SHA.
 *
 * An explicit `NEXT_PUBLIC_APP_VERSION` wins and is returned verbatim, because the Dockerfile uploads source maps
 * under that exact string (Docker CI passes the tagged commit's SHA). Otherwise the commit comes from `GIT_COMMIT`
 * (`--build-env` on a Vercel CLI deploy) or Vercel's `VERCEL_GIT_COMMIT_SHA`; only a full SHA is accepted there.
 * A build with none of them (a local build) reports `fallback`, the package version, and gets no Sentry release.
 */
export function resolveSentryRelease(env: CommitEnv, fallback: string): string {
  const explicit = env.NEXT_PUBLIC_APP_VERSION;
  if (explicit?.trim()) return explicit;
  for (const raw of [env.GIT_COMMIT, env.VERCEL_GIT_COMMIT_SHA]) {
    const sha = raw?.trim();
    if (sha && isFullCommitSha(sha)) return sha.toLowerCase();
  }
  return fallback;
}
