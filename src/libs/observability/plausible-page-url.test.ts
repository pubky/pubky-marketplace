import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  plausiblePageUrlBootstrap,
  plausiblePageUrlFromHref,
  plausibleReferrerFromHref,
  rewritePlausibleEventBody,
} from './plausible-page-url';

const SELLER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const BUYER = 'o'.repeat(52);
const LISTING_ID = '0033GVVN22HJ0FYQGZZS8R2BFC';
const CONVERSATION_ID = `conversation:${SELLER}_${BUYER}_${LISTING_ID}`;
const HREF = `https://shop.pubky.app/marketplace/messages?conversation=${encodeURIComponent(CONVERSATION_ID)}`;

const ORIGIN = 'https://shop.pubky.app';
const POST_ID = '0034A1B2C3D4E';
const INVITE_CODE = 'K7Q2-M9XW-4T8R';
const DROP_ID = '0035DROPQ7Z1';
const CONNECTION_ID = 'conn_01J9ZK3';
const FEED_ID = 'feed-7';
/** 52 characters, but `0`, `l`, `2` and `v` are outside z-base-32. */
const NON_Z32_ID = '0l2v'.repeat(13);
const Z32_RUN = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/i;

interface PageCase {
  name: string;
  path: string;
  expected: string;
}

/** App-root paths; each also runs under the `/shop` base path. */
const APP_CASES: PageCase[] = [
  { name: 'profile tab', path: `/profile/${SELLER}/followers`, expected: '/profile/:pubky/followers' },
  { name: 'profile', path: `/profile/${SELLER}`, expected: '/profile/:pubky' },
  { name: 'own profile tab', path: '/profile/followers', expected: '/profile/followers' },
  { name: 'post', path: `/post/${SELLER}/${POST_ID}`, expected: '/post/:pubky/:postId' },
  { name: 'collection', path: `/collections/${SELLER}/${POST_ID}`, expected: '/collections/:pubky/:postId' },
  {
    name: 'messages with a conversation query',
    path: `/messages/${BUYER}?conversation=${encodeURIComponent(CONVERSATION_ID)}#latest`,
    expected: '/messages/:pubky',
  },
  { name: 'invite', path: `/invite/${INVITE_CODE}`, expected: '/invite/:code' },
  { name: 'shop', path: `/marketplace/shop/pubky${SELLER}`, expected: '/marketplace/shop/:pubky' },
  {
    name: 'listing edit',
    path: `/marketplace/listing/${SELLER}/${LISTING_ID}/edit`,
    expected: '/marketplace/listing/:pubky/:listingId/edit',
  },
  { name: 'drop', path: `/marketplace/drop/${SELLER}/${DROP_ID}`, expected: '/marketplace/drop/:pubky/:dropId' },
  { name: 'seller drop', path: `/marketplace/sell/drops/${DROP_ID}`, expected: '/marketplace/sell/drops/:dropId' },
  {
    name: 'store connection',
    path: `/marketplace/settings/store-connections/${CONNECTION_ID}`,
    expected: '/marketplace/settings/store-connections/:connectionId',
  },
  { name: 'feed', path: `/feed/${FEED_ID}`, expected: '/feed/:id' },
  { name: 'pubky after a template', path: `/profile/${SELLER}/${BUYER}`, expected: '/profile/:pubky/:pubky' },
  { name: 'unknown route with a pubky', path: `/unknown/${SELLER}/details`, expected: '/unknown/:pubky/details' },
  {
    name: 'unknown route with an uppercase pubky',
    path: `/unknown/${SELLER.toUpperCase()}`,
    expected: '/unknown/:pubky',
  },
  { name: 'unknown route with a prefixed pubky', path: `/unknown/pubky${SELLER}`, expected: '/unknown/:pubky' },
  { name: 'unknown route with an encoded pubky', path: `/unknown/%70ubky${SELLER}`, expected: '/unknown/:pubky' },
  { name: 'unknown route with a pk: pubky', path: `/unknown/pk:${SELLER}`, expected: '/unknown/:pubky' },
  { name: 'unknown route with an encoded pk: pubky', path: `/unknown/pk%3A${SELLER}`, expected: '/unknown/:pubky' },
  {
    name: 'unknown route with a malformed escape',
    path: `/unknown/${SELLER}/%E0%A4%A`,
    expected: '/unknown/:pubky/%E0%A4%A',
  },
  {
    name: 'unknown route with a 52-character non-z32 id',
    path: `/unknown/${NON_Z32_ID}`,
    expected: `/unknown/${NON_Z32_ID}`,
  },
  { name: 'static route', path: '/marketplace/messages?conversation=x', expected: '/marketplace/messages' },
  { name: 'root', path: '/', expected: '/' },
];

const BASE_PATH_CASES: (PageCase & { basePath: string })[] = [
  ...APP_CASES.map((c) => ({ ...c, basePath: '' })),
  ...APP_CASES.map((c) => ({
    ...c,
    name: `${c.name} under /shop`,
    basePath: '/shop',
    path: `/shop${c.path}`,
    expected: `/shop${c.expected}`,
  })),
  { name: 'the base path itself', basePath: '/shop', path: '/shop?ref=1', expected: '/shop' },
  {
    name: 'a pubky outside the base path',
    basePath: '/shop',
    path: `/shopping/profile/${SELLER}/followers`,
    expected: '/shopping/profile/:pubky/followers',
  },
  {
    name: 'a host-app route outside the base path',
    basePath: '/shop',
    path: `/feed/${FEED_ID}`,
    expected: `/feed/${FEED_ID}`,
  },
];

const APP_DIR = join(__dirname, '../../app');
/** The catch-all intercept renders whatever post URL it intercepts, which the post template already covers. */
const EXEMPT_ROUTES = ['(feeds)/@post/[...catchAll]'];

function pageDirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pageDirectories(join(dir, entry.name));
    return entry.name === 'page.tsx' ? [relative(APP_DIR, dir)] : [];
  });
}

const APP_ROUTES = pageDirectories(APP_DIR);

/** Route groups and slots are not URL segments; an intercept marker such as `(.)` is dropped. */
function urlSegments(route: string): string[] {
  return route
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    .map((segment) => segment.replace(/^(?:\(\.{1,3}\))+/, ''));
}

/** Each app route as a sample path (dynamic segments filled in) and its expected template, with `:` for any param. */
const ROUTE_CASES = APP_ROUTES.filter((route) => !EXEMPT_ROUTES.includes(route)).map((route) => {
  const segments = urlSegments(route);
  return {
    route,
    path: `/${segments.map((segment, i) => (segment.startsWith('[') ? `sample-${i}` : segment)).join('/')}`,
    expected: `/${segments.map((segment) => (segment.startsWith('[') ? ':' : segment)).join('/')}`,
  };
});

/** The route-template mismatches of `pageUrl` over every app route, with param names collapsed to `:`. */
function routeMismatches(pageUrl: (href: string) => string): string[] {
  return ROUTE_CASES.flatMap(({ route, path, expected }) => {
    const actual = pageUrl(`${ORIGIN}${path}`)
      .slice(ORIGIN.length)
      .replace(/\/:[A-Za-z]+/g, '/:');
    return actual === expected ? [] : [`${route}: ${actual} (expected ${expected})`];
  });
}

function expectNoIdentifiers(value: string) {
  expect(value).not.toMatch(Z32_RUN);
  expect(value).not.toContain(INVITE_CODE);
  expect(value).not.toContain('conversation');
}

describe('plausiblePageUrlFromHref', () => {
  it('drops the Wave A conversation query from a Shop page URL', () => {
    expect(plausiblePageUrlFromHref(HREF)).toBe('https://shop.pubky.app/marketplace/messages');
    expect(plausiblePageUrlFromHref(HREF)).not.toContain('conversation=');
    expect(plausiblePageUrlFromHref(HREF)).not.toContain(SELLER);
    expect(plausiblePageUrlFromHref(HREF)).not.toContain(BUYER);
  });

  it.each(BASE_PATH_CASES)(
    'sends route templates instead of identifier path segments: $name',
    ({ basePath, path, expected }) => {
      expect(plausiblePageUrlFromHref(`${ORIGIN}${path}`, undefined, basePath)).toBe(`${ORIGIN}${expected}`);
    },
  );

  it('keeps only pubky-free segments of a non-http URL', () => {
    expect(plausiblePageUrlFromHref(`file:///profile/${SELLER}?q=1`)).toBe('file:///profile/:pubky');
  });
});

const PAGE_ORIGIN = location.origin;

/** Referrers and what is sent for them from a page at `PAGE_ORIGIN`. */
const REFERRER_CASES: { name: string; input: string; expected: string }[] = [
  {
    name: 'same-origin page as its route template',
    input: `${PAGE_ORIGIN}/messages/${BUYER}?conversation=x`,
    expected: `${PAGE_ORIGIN}/messages/:pubky`,
  },
  {
    name: 'cross-origin page as its origin',
    input: `https://example.com/profile/${SELLER}?q=1`,
    expected: 'https://example.com',
  },
  { name: 'empty as nothing', input: '', expected: '' },
  { name: 'invalid as nothing', input: 'not a url', expected: '' },
  { name: 'relative as nothing', input: '/relative/path', expected: '' },
  { name: 'non-http app as its scheme and host', input: `android-app://app/${SELLER}`, expected: 'android-app://app' },
  {
    name: 'Gmail app as its scheme and host',
    input: 'android-app://com.google.android.gm/',
    expected: 'android-app://com.google.android.gm',
  },
  { name: 'hostless non-http as nothing', input: 'mailto:x@example.com', expected: '' },
];

describe('plausibleReferrerFromHref', () => {
  it('sends same-origin referrers as route templates', () => {
    expect(plausibleReferrerFromHref(`${ORIGIN}/messages/${BUYER}?conversation=x`, ORIGIN)).toBe(
      `${ORIGIN}/messages/:pubky`,
    );
    expect(plausibleReferrerFromHref(`${ORIGIN}/shop/invite/${INVITE_CODE}`, ORIGIN, '/shop')).toBe(
      `${ORIGIN}/shop/invite/:code`,
    );
  });

  it('sends only the origin of a cross-origin referrer', () => {
    expect(plausibleReferrerFromHref(`https://example.com/profile/${SELLER}?q=1`, ORIGIN)).toBe('https://example.com');
  });

  it.each(REFERRER_CASES)('sends a $name referrer', ({ input, expected }) => {
    expect(plausibleReferrerFromHref(input, PAGE_ORIGIN)).toBe(expected);
  });
});

const MALFORMED_ESCAPE = '%E0%A4%A';
const PAGE_HREF = `${PAGE_ORIGIN}/invite/${INVITE_CODE}`;
const REFERRER_HREF = `${PAGE_ORIGIN}/messages/${BUYER}?conversation=x`;
/** A form body with a page URL but no event name. */
const NON_EVENT_BODY = `u=${encodeURIComponent(`${PAGE_ORIGIN}/profile/${SELLER}`)}`;

/** Bodies that are kept as sent, wholly or in the one pair that cannot be decoded. */
const MALFORMED_BODY_CASES: { name: string; body: string; expected: string }[] = [
  ...[
    { name: 'invalid JSON', body: `{"n":"pageview","u":"${PAGE_HREF}"` },
    { name: 'JSON without an event name', body: JSON.stringify({ u: PAGE_HREF, r: REFERRER_HREF }) },
  ].map((c) => ({ ...c, expected: c.body })),
  {
    name: 'form page URL with a malformed escape',
    body: `n=pageview&u=${MALFORMED_ESCAPE}&r=${encodeURIComponent(REFERRER_HREF)}`,
    expected: `n=pageview&u=${MALFORMED_ESCAPE}&r=${encodeURIComponent(`${PAGE_ORIGIN}/messages/:pubky`)}`,
  },
  {
    name: 'form referrer with a malformed escape',
    body: `n=pageview&u=${encodeURIComponent(PAGE_HREF)}&r=${MALFORMED_ESCAPE}`,
    expected: `n=pageview&u=${encodeURIComponent(`${PAGE_ORIGIN}/invite/:code`)}&r=${MALFORMED_ESCAPE}`,
  },
];

describe('rewritePlausibleEventBody', () => {
  it.each(MALFORMED_BODY_CASES)('leaves malformed bodies and pairs untouched: $name', ({ body, expected }) => {
    expect(rewritePlausibleEventBody(body, { pageOrigin: PAGE_ORIGIN })).toBe(expected);
  });

  it('leaves non-event bodies untouched', () => {
    expect(rewritePlausibleEventBody(NON_EVENT_BODY, { pageOrigin: PAGE_ORIGIN })).toBe(NON_EVENT_BODY);
  });

  it('strips query strings from JSON pageview payloads', () => {
    const rewritten = rewritePlausibleEventBody(JSON.stringify({ n: 'pageview', u: HREF, d: 'shop.pubky.app' }));
    const parsed = JSON.parse(rewritten) as { u: string };
    expect(parsed.u).toBe('https://shop.pubky.app/marketplace/messages');
    expect(rewritten).not.toContain('conversation=');
    expect(rewritten).not.toContain(CONVERSATION_ID);
  });

  it('strips query strings from form-encoded pageview payloads', () => {
    const rewritten = rewritePlausibleEventBody(`n=pageview&u=${encodeURIComponent(HREF)}&d=shop.pubky.app`);
    expect(rewritten).toContain('u=' + encodeURIComponent('https://shop.pubky.app/marketplace/messages'));
    expect(rewritten).not.toContain('conversation');
  });

  it('sends route templates for the page and referrer in JSON payloads', () => {
    const rewritten = rewritePlausibleEventBody(
      JSON.stringify({
        n: 'pageview',
        u: `${ORIGIN}/shop/invite/${INVITE_CODE}`,
        r: `${ORIGIN}/shop/messages/${BUYER}?conversation=x`,
      }),
      { pageOrigin: ORIGIN, basePath: '/shop' },
    );
    expect(JSON.parse(rewritten)).toEqual({
      n: 'pageview',
      u: `${ORIGIN}/shop/invite/:code`,
      r: `${ORIGIN}/shop/messages/:pubky`,
    });
    expectNoIdentifiers(rewritten);
  });

  it('sends route templates for the page and referrer in form-encoded payloads', () => {
    const rewritten = rewritePlausibleEventBody(
      `n=pageview&r=${encodeURIComponent(`https://example.com/profile/${SELLER}`)}&u=${encodeURIComponent(
        `${ORIGIN}/profile/${SELLER}/replies`,
      )}`,
      { pageOrigin: ORIGIN },
    );
    expect(rewritten).toBe(
      `n=pageview&r=${encodeURIComponent('https://example.com')}&u=${encodeURIComponent(
        `${ORIGIN}/profile/:pubky/replies`,
      )}`,
    );
  });

  it('treats referrers as cross-origin when the page origin is unknown', () => {
    const rewritten = rewritePlausibleEventBody(
      JSON.stringify({ n: 'pageview', u: `${ORIGIN}/`, r: `${ORIGIN}/profile/${SELLER}` }),
    );
    expect((JSON.parse(rewritten) as { r: string }).r).toBe(ORIGIN);
  });
});

type PlausibleQueue = { q?: unknown[][] };
type PlausibleWindow = Window & {
  plausible?: ((eventName: string, options?: { u?: string }) => void) & PlausibleQueue;
};

describe('plausiblePageUrlBootstrap', () => {
  const plausibleWindow = window as PlausibleWindow;
  let savedSendBeacon: PropertyDescriptor | undefined;
  let savedSend: XMLHttpRequest['send'];
  let sendBeacon: Mock;
  let fetchStub: Mock;
  let xhrSend: Mock;

  function runBootstrap(basePath: string) {
    new Function(plausiblePageUrlBootstrap(basePath))();
  }

  function beaconPageUrl(href: string): string {
    navigator.sendBeacon('/api/event', JSON.stringify({ n: 'pageview', u: href }));
    return (JSON.parse(sendBeacon.mock.lastCall?.[1] as string) as { u: string }).u;
  }

  beforeEach(() => {
    savedSendBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
    savedSend = XMLHttpRequest.prototype.send;
    sendBeacon = vi.fn(() => true);
    fetchStub = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    xhrSend = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, writable: true, value: sendBeacon });
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal('plausible', undefined);
    XMLHttpRequest.prototype.send = xhrSend;
  });

  afterEach(() => {
    if (savedSendBeacon) Object.defineProperty(navigator, 'sendBeacon', savedSendBeacon);
    else Reflect.deleteProperty(navigator, 'sendBeacon');
    vi.unstubAllGlobals();
    XMLHttpRequest.prototype.send = savedSend;
  });

  it('stays parseable by older engines (ES5 syntax, no lookbehind)', () => {
    const source = plausiblePageUrlBootstrap('/shop');
    expect(source).not.toContain('(?<=');
    expect(source).not.toContain('(?<!');
    expect(source).not.toContain('=>');
    expect(source).not.toContain('`');
    expect(source).not.toMatch(/\blet\s/);
    expect(source).not.toMatch(/\bconst\s/);
    expect(() => new Function(source)).not.toThrow();
  });

  it('inlines the base path without closing the script element', () => {
    const source = plausiblePageUrlBootstrap('</script><!--&\u2028\u2029');
    expect(source).not.toContain('</script');
    expect(source).not.toContain('<!--');
    expect(source).not.toMatch(/[\u2028\u2029]/);
    expect(() => new Function(source)).not.toThrow();
  });

  it.each(BASE_PATH_CASES)(
    'sends route templates instead of identifier path segments: $name',
    ({ basePath, path, expected }) => {
      runBootstrap(basePath);
      expect(beaconPageUrl(`${location.origin}${path}`)).toBe(`${location.origin}${expected}`);
    },
  );

  it('sends route templates for the page and referrer in fetch JSON bodies', async () => {
    runBootstrap('/shop');
    await window.fetch('/api/event', {
      method: 'POST',
      body: JSON.stringify({
        n: 'pageview',
        u: `${location.origin}/shop/invite/${INVITE_CODE}?ref=x`,
        r: `${location.origin}/shop/messages/${BUYER}?conversation=${encodeURIComponent(CONVERSATION_ID)}`,
      }),
    });
    const body = (fetchStub.mock.lastCall?.[1] as RequestInit).body as string;
    expect(JSON.parse(body)).toEqual({
      n: 'pageview',
      u: `${location.origin}/shop/invite/:code`,
      r: `${location.origin}/shop/messages/:pubky`,
    });
    expectNoIdentifiers(body);
  });

  it('sends route templates for the page and referrer in XHR form bodies', () => {
    runBootstrap('/shop');
    const xhr = new XMLHttpRequest();
    xhr.send(
      `n=pageview&u=${encodeURIComponent(`${location.origin}/shop/post/${SELLER}/${POST_ID}`)}&r=${encodeURIComponent(
        `https://example.com/invite/${INVITE_CODE}`,
      )}&d=shop.pubky.app`,
    );
    const body = xhrSend.mock.lastCall?.[0] as string;
    expect(body).toBe(
      `n=pageview&u=${encodeURIComponent(`${location.origin}/shop/post/:pubky/:postId`)}&r=${encodeURIComponent(
        'https://example.com',
      )}&d=shop.pubky.app`,
    );
    expect(xhrSend.mock.contexts[0]).toBe(xhr);
    expectNoIdentifiers(decodeURIComponent(body));
  });

  it('keeps a missing referrer missing', () => {
    runBootstrap('');
    navigator.sendBeacon('/api/event', JSON.stringify({ n: 'pageview', u: `${location.origin}/`, r: null }));
    navigator.sendBeacon('/api/event', `n=pageview&u=${encodeURIComponent(`${location.origin}/`)}&r=`);
    expect(JSON.parse(sendBeacon.mock.calls[0][1] as string)).toMatchObject({ r: null });
    expect(sendBeacon.mock.calls[1][1]).toBe(`n=pageview&u=${encodeURIComponent(`${location.origin}/`)}&r=`);
  });

  it('leaves non-event bodies untouched', () => {
    runBootstrap('');
    navigator.sendBeacon('/api/other', NON_EVENT_BODY);
    expect(sendBeacon.mock.lastCall?.[1]).toBe(NON_EVENT_BODY);
  });

  it.each(MALFORMED_BODY_CASES)('leaves malformed bodies and pairs untouched: $name', ({ body, expected }) => {
    runBootstrap('');
    expect(() => navigator.sendBeacon('/api/event', body)).not.toThrow();
    expect(sendBeacon.mock.lastCall?.[1]).toBe(expected);
  });

  it('keeps only pubky-free segments of a non-http URL', () => {
    runBootstrap('');
    expect(beaconPageUrl(`file:///profile/${SELLER}?q=1`)).toBe('file:///profile/:pubky');
  });

  it.each(REFERRER_CASES)('sends a $name referrer', ({ input, expected }) => {
    runBootstrap('');
    navigator.sendBeacon('/api/event', JSON.stringify({ n: 'pageview', u: `${location.origin}/`, r: input }));
    expect((JSON.parse(sendBeacon.mock.lastCall?.[1] as string) as { r: string }).r).toBe(expected);
  });

  it('maps every app route to its route template', () => {
    runBootstrap('');
    expect(routeMismatches(beaconPageUrl)).toEqual([]);
  });

  it('sends route templates for window.plausible page URLs', () => {
    const originalPath = location.pathname + location.search + location.hash;
    runBootstrap('');
    plausibleWindow.plausible?.('pageview', { u: `${location.origin}/messages/${BUYER}?conversation=x` });
    history.pushState({}, '', `/profile/${SELLER}?ref=x`);
    try {
      plausibleWindow.plausible?.('signup');
    } finally {
      history.replaceState({}, '', originalPath);
    }
    expect(plausibleWindow.plausible?.q).toEqual([
      ['pageview', { u: `${location.origin}/messages/:pubky` }],
      ['signup', { u: `${location.origin}/profile/:pubky` }],
    ]);
    expect(JSON.stringify(plausibleWindow.plausible?.q)).not.toMatch(Z32_RUN);
  });
});

describe('Plausible route templates', () => {
  it('maps every app route to its route template', () => {
    expect(ROUTE_CASES.some(({ route }) => route.includes('['))).toBe(true);
    expect(routeMismatches((href) => plausiblePageUrlFromHref(href))).toEqual([]);
  });

  it('lists only exemptions that exist', () => {
    for (const route of EXEMPT_ROUTES) expect(APP_ROUTES).toContain(route);
  });
});
