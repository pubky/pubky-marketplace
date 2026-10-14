import { getDefaultUrl } from '@/config/metadata';
import { prefixWithBasePath, stripBasePath } from '@/libs/base-path/base-path';
import { Env } from '@/libs/env/env';
import { getShopPublicPathOverride } from '@/libs/runtime-config/runtime-config';

/**
 * Mount path the Shop is served under (`''` when served from the origin root).
 * Read per call rather than captured at import, so one artifact holds a single
 * baked value and tests can exercise both states.
 */
export function getBasePath(): string {
  return Env.NEXT_PUBLIC_BASE_PATH;
}

/**
 * Prefix an app-absolute path with the mount path. Use it for every URL the
 * Next.js router does not rewrite for us: `fetch('/api/...')`, `<img src>`,
 * `<video src>`, CSS `url()`, metadata icons and `window.location` targets.
 * `next/link`, `router.push` and `next/image` loaders handle it themselves.
 */
export function withBasePath(path: string): string {
  return prefixWithBasePath(getBasePath(), path);
}

/** The pathname without the mount path (what `usePathname()` reports). */
export function withoutBasePath(pathname: string): string {
  return stripBasePath(getBasePath(), pathname);
}

/**
 * The path people use to reach the Shop at the top level. It is the mount path unless the
 * host app serves the Shop's pages somewhere else: on pubky.app the App owns `/shop` and frames
 * the build mounted at `/shop-embed`, so `PUBKY_RUNTIME_SHOP_PUBLIC_PATH=/shop` makes every
 * link a person copies, shares, bookmarks or is returned to point at `/shop`, where the App's
 * chrome and session are. Assets, API calls and the Passport popup return keep the mount path,
 * because they are requested by the iframe itself.
 */
export function getShopPublicPath(): string {
  return getShopPublicPathOverride() ?? getBasePath();
}

/**
 * Prefix an app-absolute path with the public path. Use it for a URL that leaves the page and
 * comes back top-level: share links, canonical and Open Graph URLs. Same pass-through rules as
 * {@link withBasePath}.
 */
export function withPublicPath(path: string): string {
  return prefixWithBasePath(getShopPublicPath(), path);
}

/**
 * The Shop's public base URL: the configured site origin (`PUBKY_RUNTIME_DEFAULT_URL`) plus
 * the public path. `PUBKY_RUNTIME_DEFAULT_URL` stays an origin; the public path is appended
 * here so canonical, share and structured-data URLs point at the page people open.
 */
export function getShopBaseUrl(): string {
  return `${getDefaultUrl()}${getShopPublicPath()}`;
}
