const COMMIT_UNKNOWN = 'unknown';
const COMMIT_SHORT_LENGTH = 12;
const COMMIT_MIN_LENGTH = 7;

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
