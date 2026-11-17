import type { NextRequest } from 'next/server';

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
