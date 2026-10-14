// Where the launch-critical suite finds the Shop. `LAUNCH_E2E_BASE_URL` is the origin plus the Shop build's
// mount path (`NEXT_PUBLIC_BASE_PATH`): `http://127.0.0.1:3000` for a standalone build,
// `http://127.0.0.1:3000/shop-embed` for the build the App frames at `https://pubky.app/shop`.
// The suite drives the build itself, never the App's `/shop` wrapper, so only the mount path matters here.
export function launchTarget(raw = 'http://127.0.0.1:3000') {
  const url = new URL(raw);
  if (url.search || url.hash) throw new Error('LAUNCH_E2E_BASE_URL must not carry a query or fragment');
  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    origin: url.origin,
    basePath,
    baseUrl: `${url.origin}${basePath}`,
    // A pathname as the browser reports it, without the mount path: `/shop-embed/marketplace` -> `/marketplace`.
    routeOf(pathname) {
      if (basePath === '') return pathname;
      if (pathname === basePath) return '/';
      return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
    },
  };
}
