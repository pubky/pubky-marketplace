import { getBasePath, withBasePath } from '@/config/base-path';
import { getSocialHostUrl } from '@/config/social';
import { canonicalSocialPath } from '@/libs/social-host/social-host';

type Context = { params: Promise<{ segments: string[] }> };

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// A route handler bypasses the Shop's React auth/database gate, including for signed-out users.
// Only GET and HEAD are supported. In particular this never relays a share POST or file upload.
export async function GET(request: Request, { params }: Context) {
  const path = canonicalSocialPath((await params).segments);
  if (!path) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const destination = getSocialHostUrl(path) + url.search;
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!getBasePath() && new URL(destination, url).origin === url.origin) {
    return new Response('Set NEXT_PUBLIC_SOCIAL_HOST to the origin serving Pubky App.', { status: 503, headers });
  }
  const requestDestination = request.headers.get('sec-fetch-dest');
  if (
    requestDestination === 'document' ||
    (!getBasePath() && requestDestination !== 'iframe' && requestDestination !== 'frame')
  ) {
    return new Response(null, { status: 307, headers: { ...headers, Location: destination } });
  }

  // A redirect would put the full social App inside the Shop iframe. Keep a real top-level link
  // available when the browser requires a user gesture for cross-origin navigation.
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Open in Pubky</title><a href="${escapeAttribute(destination)}" target="_top">Open in Pubky</a><script src="${escapeAttribute(withBasePath('/social-handoff.js'))}" defer></script></html>`;
  return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
