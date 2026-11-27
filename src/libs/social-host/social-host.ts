export const SOCIAL_HOST_ENV_VAR = 'NEXT_PUBLIC_SOCIAL_HOST';

/**
 * Shop paths that leave for the social host, unchanged (path and query), in
 * Next.js rewrite source syntax. The Shop's former social routes follow the same
 * tree as the App's. The handoff resolves the legacy profile posts alias.
 * `:path*` also matches the bare prefix (`/profile`, `/settings`, ...).
 */
export const SOCIAL_LINK_OUT_SOURCES = [
  '/home',
  '/feed/:path*',
  '/hot',
  '/search',
  '/who-to-follow',
  '/share',
  '/post/:path*',
  '/collections/:path*',
  '/profile/:path*',
  '/settings/:path*',
] as const;

/**
 * Exact `https://` origin, or `http://localhost:<port>` when `nodeEnv !== 'production'`.
 * Paths, trailing slashes, bare hosts and non-loopback `http://` fail.
 */
export function isValidSocialHost(value: string, nodeEnv: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== value) return false;
  if (url.protocol === 'https:') return true;
  return nodeEnv !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost';
}

/** The runtime-config variable holding the Shop's canonical URL (`defaultUrl`). */
export const SHOP_DEFAULT_URL_ENV_VAR = 'PUBKY_RUNTIME_DEFAULT_URL';

/** Vercel system variables naming the hosts a build is served from (no scheme). */
const VERCEL_HOST_ENV_VARS = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL'] as const;

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Origins this Shop build is served from: the explicitly configured canonical
 * URL, plus the deployment, branch and production hosts on Vercel. The
 * runtime-config default (upstream's `https://pubky.app`) is deliberately not
 * used, because an unset value says nothing about where the Shop runs.
 */
export function resolveShopOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  const candidates = [
    env[SHOP_DEFAULT_URL_ENV_VAR],
    ...VERCEL_HOST_ENV_VARS.map((name) => (env[name] ? `https://${env[name]}` : undefined)),
  ];
  const origins = candidates
    .filter((value): value is string => Boolean(value))
    .map(toOrigin)
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}

/** `origin` with a leading `www.` dropped from the host, so `www.` and bare hosts compare equal. */
function withoutWww(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.replace(/^www\./, '');
  return url.origin;
}

/**
 * Unset or empty → `undefined` (use the mount and deployment defaults). An invalid value throws so a bad
 * build fails loudly. So does a value naming one of `shopOrigins`, with or
 * without a leading `www.` on either side: every social route would 307 back
 * to itself.
 */
export function parseSocialHost(
  value: string | undefined,
  nodeEnv: string | undefined,
  shopOrigins: readonly string[],
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isValidSocialHost(value, nodeEnv)) {
    throw new Error(
      `${SOCIAL_HOST_ENV_VAR} must be an exact https:// origin (e.g. https://pubky.app), ` +
        `or http://localhost:<port> outside production builds. Received: ${JSON.stringify(value)}`,
    );
  }
  const host = withoutWww(value);
  if (shopOrigins.some((origin) => withoutWww(origin) === host)) {
    throw new Error(
      `${SOCIAL_HOST_ENV_VAR} must name the social app, not this Shop (${JSON.stringify(value)}); ` +
        'every social route would redirect to itself.',
    );
  }
  return value;
}

/** Only the retired public routes can be handed to the App. */
export function canonicalSocialPath(segments: readonly string[]): string | null {
  if (!segments.length || segments.some((part) => !part || part === '.' || part === '..' || /[/\\]/.test(part)))
    return null;
  const [first, ...rest] = segments;
  if (
    !SOCIAL_LINK_OUT_SOURCES.some((source) => source === `/${first}/:path*` || (!rest.length && source === `/${first}`))
  )
    return null;
  if (first === 'profile' && rest.length === 1 && rest[0] === 'notifications') return null;
  if (first === 'profile' && rest.length === 2 && rest[1] === 'posts') return `/profile/${encodeURIComponent(rest[0])}`;
  return '/' + segments.map(encodeURIComponent).join('/');
}
