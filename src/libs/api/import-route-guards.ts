import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { trustedClientIp } from '@/libs/api/client-ip';

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
