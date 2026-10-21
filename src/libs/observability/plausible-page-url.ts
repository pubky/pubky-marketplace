/**
 * Analytics page and referrer URLs carry route templates, not identifiers
 * (`docs/ecommerce/onboarding.md`: telemetry carries static text only). Plausible
 * classic scripts record `location.href` and `document.referrer`; both are reduced
 * to origin + route template, for example `/profile/:pubky/followers`.
 */

/** z-base-32, the alphabet of pubky public keys. */
const Z32_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769';

/** A whole path segment that is a pubky, with or without the `pubky` or legacy `pk:` prefix. */
const PUBKY_SEGMENT = new RegExp(`^(?:pubky|pk:)?[${Z32_ALPHABET}]{52}$`, 'i');

/**
 * The dynamic routes under `src/app`, as URL paths. A `:name` segment stands for
 * any non-empty value; any other segment must match exactly. Extra trailing
 * segments are kept (`/profile/:pubky/followers`), and the first match wins.
 * Route groups such as `(feeds)` and slots such as `@post` are not URL segments,
 * and an intercepted `(.)post` route is served at `/post`.
 *
 * Static routes that share a prefix with a dynamic one come first, as in Next.js
 * routing, so `/profile/followers` is not read as `/profile/:pubky`.
 *
 * Plain data: the inline bootstrap embeds this same list.
 */
const ROUTE_TEMPLATES: readonly string[] = [
  '/profile/collections',
  '/profile/followers',
  '/profile/following',
  '/profile/friends',
  '/profile/posts',
  '/profile/profile',
  '/profile/replies',
  '/profile/tagged',
  '/profile/tags',
  '/profile/:pubky',
  '/post/:pubky/:postId',
  '/collections/:pubky/:postId',
  '/messages/:pubky',
  '/invite/:code',
  '/marketplace/shop/:pubky',
  '/marketplace/listing/:pubky/:listingId',
  '/marketplace/drop/:pubky/:dropId',
  '/marketplace/sell/drops/:dropId',
  '/marketplace/settings/store-connections/:connectionId',
  '/feed/:id',
];

const ROUTE_TEMPLATE_SEGMENTS: readonly (readonly string[])[] = ROUTE_TEMPLATES.map((entry) => entry.split('/'));

export interface PlausibleUrlContext {
  /** Origin of the page sending the event; referrers from it are templated, others keep only their origin. */
  pageOrigin?: string;
  /** Mount path the Shop is served under (`''` at the origin root). */
  basePath?: string;
}

function isPubkySegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed escapes: test the raw segment.
  }
  return PUBKY_SEGMENT.test(decoded);
}

function matchesTemplate(template: readonly string[], segments: string[]): boolean {
  return (
    template.length <= segments.length &&
    template.every((part, i) => (part.startsWith(':') ? segments[i] !== '' : part === segments[i]))
  );
}

/** Replace the segments of the first matching template, then any remaining pubky segment with `:pubky`. */
function applyRouteTemplates(path: string, templates: readonly (readonly string[])[]): string {
  const segments = path.split('/');
  const template = templates.find((entry) => matchesTemplate(entry, segments));
  return segments
    .map((segment, i) => {
      if (template && i < template.length) return template[i];
      return isPubkySegment(segment) ? ':pubky' : segment;
    })
    .join('/');
}

/** Template the path inside the base path; paths outside it only lose pubky segments. */
function templatePathname(pathname: string, basePath: string): string {
  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
    return basePath + applyRouteTemplates(pathname.slice(basePath.length), ROUTE_TEMPLATE_SEGMENTS);
  }
  return applyRouteTemplates(pathname, []);
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** Host of a non-http(s) referrer, with a pubky host as `:pubky`. */
function appReferrerHost(url: URL): string {
  return isPubkySegment(url.hostname) ? ':pubky' : url.host;
}

export function plausiblePageUrlFromHref(href: string, base = 'https://invalid.invalid', basePath = ''): string {
  try {
    const url = new URL(href, base);
    if (isHttpUrl(url)) {
      return `${url.origin}${templatePathname(url.pathname, basePath)}`;
    }
  } catch {
    // fall through
  }
  return applyRouteTemplates(href.split('#')[0].split('?')[0], []);
}

/**
 * Same-origin referrers get the page treatment; other http(s) origins keep only the
 * origin. Other schemes keep scheme and host, such as the app referrer
 * `android-app://com.google.android.gm`, or send nothing when there is no host.
 * A host that is a pubky becomes `:pubky`, so `pubky://<pubky>/profile` is sent as
 * `pubky://:pubky`.
 */
export function plausibleReferrerFromHref(ref: string, pageOrigin: string, basePath = ''): string {
  try {
    const url = new URL(ref);
    if (!isHttpUrl(url)) return url.host ? `${url.protocol}//${appReferrerHost(url)}` : '';
    return url.origin === pageOrigin ? plausiblePageUrlFromHref(ref, pageOrigin, basePath) : url.origin;
  } catch {
    return '';
  }
}

/** TypeScript twin of the bootstrap's `rewrite`: keep the two in step. */
export function rewritePlausibleEventBody(
  body: string,
  { pageOrigin = '', basePath = '' }: PlausibleUrlContext = {},
): string {
  const pageUrl = (href: string) => plausiblePageUrlFromHref(href, pageOrigin || undefined, basePath);
  const referrer = (ref: string) => plausibleReferrerFromHref(ref, pageOrigin, basePath);

  if (body.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'n' in parsed &&
        'u' in parsed &&
        typeof (parsed as { n: unknown }).n === 'string' &&
        typeof (parsed as { u: unknown }).u === 'string'
      ) {
        const event = parsed as { n: string; u: string; r?: unknown; [key: string]: unknown };
        event.u = pageUrl(event.u);
        if (typeof event.r === 'string') event.r = referrer(event.r);
        return JSON.stringify(event);
      }
    } catch {
      return body;
    }
    return body;
  }

  const pairs = body.split('&');
  if (!pairs.some((pair) => pair.startsWith('n=')) || !pairs.some((pair) => pair.startsWith('u='))) return body;

  return pairs
    .map((pair) => {
      const key = pair.slice(0, 2);
      if (key !== 'u=' && key !== 'r=') return pair;
      try {
        const value = decodeURIComponent(pair.slice(2));
        return key + encodeURIComponent(key === 'u=' ? pageUrl(value) : referrer(value));
      } catch {
        return pair;
      }
    })
    .join('&');
}

/** JSON for an inline `<script>`: no `</script>`, `<!--` or raw line separators. */
function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Inline bootstrap: rewrite Plausible page and referrer URLs to origin + route
 * template before the tracker script's first pageview. Keep as an IIFE string —
 * it runs as a raw <script> during document parse, ahead of next/script
 * afterInteractive. ES5 only and no regex literals: one unsupported construct
 * would stop the whole script from parsing, so the one regex is built from a
 * string inside a try block.
 */
export function plausiblePageUrlBootstrap(basePath: string): string {
  return `(function(){
  var TEMPLATES = ${inlineScriptJson(ROUTE_TEMPLATES)};
  var BASE_PATH = ${inlineScriptJson(basePath)};
  for (var s = 0; s < TEMPLATES.length; s++) TEMPLATES[s] = TEMPLATES[s].split('/');
  var pubkySegment = null;
  try {
    pubkySegment = new RegExp(${inlineScriptJson(PUBKY_SEGMENT.source)}, 'i');
  } catch (e) {}
  function isPubkySegment(segment){
    var decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch (e) {}
    return pubkySegment ? pubkySegment.test(decoded) : false;
  }
  function matchesTemplate(template, segments){
    if (template.length > segments.length) return false;
    for (var i = 0; i < template.length; i++) {
      if (template[i].charAt(0) === ':' ? segments[i] === '' : template[i] !== segments[i]) return false;
    }
    return true;
  }
  function applyRouteTemplates(path, templates){
    var segments = path.split('/');
    var template = null;
    for (var t = 0; t < templates.length && !template; t++) {
      if (matchesTemplate(templates[t], segments)) template = templates[t];
    }
    for (var i = 0; i < segments.length; i++) {
      if (template && i < template.length) segments[i] = template[i];
      else if (isPubkySegment(segments[i])) segments[i] = ':pubky';
    }
    return segments.join('/');
  }
  function templatePathname(pathname){
    if (pathname === BASE_PATH || pathname.indexOf(BASE_PATH + '/') === 0) {
      return BASE_PATH + applyRouteTemplates(pathname.slice(BASE_PATH.length), TEMPLATES);
    }
    return applyRouteTemplates(pathname, []);
  }
  function isHttpUrl(url){
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  function pageUrl(href){
    try {
      var url = new URL(href, location.href);
      if (isHttpUrl(url)) return url.origin + templatePathname(url.pathname);
    } catch (e) {}
    return applyRouteTemplates(String(href).split('#')[0].split('?')[0], []);
  }
  function appReferrerHost(url){
    return isPubkySegment(url.hostname) ? ':pubky' : url.host;
  }
  function referrerUrl(ref){
    try {
      var url = new URL(ref);
      if (!isHttpUrl(url)) return url.host ? url.protocol + '//' + appReferrerHost(url) : '';
      return url.origin === location.origin ? pageUrl(ref) : url.origin;
    } catch (e) {
      return '';
    }
  }
  function rewrite(body){
    if (body == null || typeof body !== 'string') return body;
    if (body.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(body);
        if (parsed && typeof parsed.n === 'string' && typeof parsed.u === 'string') {
          parsed.u = pageUrl(parsed.u);
          if (typeof parsed.r === 'string') parsed.r = referrerUrl(parsed.r);
          return JSON.stringify(parsed);
        }
      } catch (e) {}
      return body;
    }
    var pairs = body.split('&');
    var hasName = false;
    var hasUrl = false;
    for (var i = 0; i < pairs.length; i++) {
      var prefix = pairs[i].slice(0, 2);
      if (prefix === 'n=') hasName = true;
      if (prefix === 'u=') hasUrl = true;
    }
    if (!hasName || !hasUrl) return body;
    for (var j = 0; j < pairs.length; j++) {
      var key = pairs[j].slice(0, 2);
      if (key !== 'u=' && key !== 'r=') continue;
      try {
        var value = decodeURIComponent(pairs[j].slice(2));
        pairs[j] = key + encodeURIComponent(key === 'u=' ? pageUrl(value) : referrerUrl(value));
      } catch (e) {}
    }
    return pairs.join('&');
  }
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data){
      return beacon(url, rewrite(data));
    };
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    if (init && init.body != null && typeof init.body === 'string') {
      init = Object.assign({}, init, { body: rewrite(init.body) });
    }
    return origFetch(input, init);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body){
    return origSend.call(this, rewrite(body));
  };
  window.plausible = function(eventName, options){
    options = options ? Object.assign({}, options) : {};
    options.u = pageUrl(options.u || location.href);
    (window.plausible.q = window.plausible.q || []).push([eventName, options]);
  };
})();`;
}
