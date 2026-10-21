import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Mirrors the BFF session cookie name (src/server/marketplace-grant/bff.ts); importing that module would pull the grant database into these routes.
const SESSION_COOKIE = '__Host-shop-bff-session';

/**
 * Browser CSRF guard, not authentication. `Sec-Fetch-Site` is set by the browser and
 * cannot be forged by a web page; older browsers without it must send an Origin that
 * matches this request's own host. Forwarded-host headers are never trusted.
 * A non-browser client can set any header, so it passes; it is bounded by the
 * per-IP and global limits, not by this check.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';

  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === request.nextUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Both buckets always apply: a forged session cookie cannot dodge the IP bucket,
 * and a shared IP (office, NAT) cannot starve one seller past their own bucket.
 */
export function importRateLimitKeys(request: NextRequest): string[] {
  const keys = [`ip:${trustedClientIp(request) ?? 'unknown'}`];
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) keys.push(`session:${createHash('sha256').update(session).digest('hex')}`);
  return keys;
}

/**
 * The client address as seen by the nearest trusted proxy: Vercel's own header on
 * Vercel, else the X-Forwarded-For hop `SHOP_BFF_CLI_TRUSTED_PROXY_COUNT` places from
 * the right. Hops are counted from the right because the client can write any
 * value at the left of X-Forwarded-For. Null when no trusted hop is available.
 */
export function trustedClientIp(request: NextRequest): string | null {
  if (process.env.VERCEL === '1') {
    const forwarded = lastHop(request.headers.get('x-vercel-forwarded-for'));
    if (forwarded) return forwarded;
  }

  const trustedProxies = Number(process.env.SHOP_BFF_CLI_TRUSTED_PROXY_COUNT ?? 0);
  const hops = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (Number.isInteger(trustedProxies) && trustedProxies >= 1 && hops.length >= trustedProxies) {
    return hops[hops.length - trustedProxies];
  }
  return null;
}

function lastHop(header: string | null): string {
  const hops = (header ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops[hops.length - 1] ?? '';
}
