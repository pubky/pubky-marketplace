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

  it('sends nothing for an empty, invalid or non-http referrer', () => {
    expect(plausibleReferrerFromHref('', ORIGIN)).toBe('');
    expect(plausibleReferrerFromHref('not a url', ORIGIN)).toBe('');
    expect(plausibleReferrerFromHref('/relative/path', ORIGIN)).toBe('');
    expect(plausibleReferrerFromHref(`android-app://app/${SELLER}`, ORIGIN)).toBe('');
  });
});

describe('rewritePlausibleEventBody', () => {
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
  let saved: {
    sendBeacon: PropertyDescriptor | undefined;
    fetch: PropertyDescriptor | undefined;
    plausible: PropertyDescriptor | undefined;
    send: XMLHttpRequest['send'];
  };
  let sendBeacon: Mock;
  let fetchStub: Mock;
  let xhrSend: Mock;

  function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }

  function stubProperty(target: object, key: string, value: unknown) {
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
  }

  function runBootstrap(basePath: string) {
    new Function(plausiblePageUrlBootstrap(basePath))();
  }

  function beaconPageUrl(href: string): string {
    navigator.sendBeacon('/api/event', JSON.stringify({ n: 'pageview', u: href }));
    return (JSON.parse(sendBeacon.mock.lastCall?.[1] as string) as { u: string }).u;
  }

  beforeEach(() => {
    saved = {
      sendBeacon: Object.getOwnPropertyDescriptor(navigator, 'sendBeacon'),
      fetch: Object.getOwnPropertyDescriptor(window, 'fetch'),
      plausible: Object.getOwnPropertyDescriptor(window, 'plausible'),
      send: XMLHttpRequest.prototype.send,
    };
    sendBeacon = vi.fn(() => true);
    fetchStub = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    xhrSend = vi.fn();
    stubProperty(navigator, 'sendBeacon', sendBeacon);
    stubProperty(window, 'fetch', fetchStub);
    stubProperty(window, 'plausible', undefined);
    XMLHttpRequest.prototype.send = xhrSend;
  });

  afterEach(() => {
    restoreProperty(navigator, 'sendBeacon', saved.sendBeacon);
    restoreProperty(window, 'fetch', saved.fetch);
    restoreProperty(window, 'plausible', saved.plausible);
    XMLHttpRequest.prototype.send = saved.send;
  });

  it('parses in engines without lookbehind support', () => {
    const source = plausiblePageUrlBootstrap('/shop');
    expect(source).not.toContain('(?<=');
    expect(source).not.toContain('(?<!');
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
    const body = `u=${encodeURIComponent(`${location.origin}/profile/${SELLER}`)}`;
    navigator.sendBeacon('/api/other', body);
    expect(sendBeacon.mock.lastCall?.[1]).toBe(body);
  });

  it('sends route templates for window.plausible page URLs', () => {
    runBootstrap('');
    plausibleWindow.plausible?.('pageview', { u: `${location.origin}/messages/${BUYER}?conversation=x` });
    plausibleWindow.plausible?.('signup');
    expect(plausibleWindow.plausible?.q).toEqual([
      ['pageview', { u: `${location.origin}/messages/:pubky` }],
      ['signup', { u: `${location.origin}${location.pathname}` }],
    ]);
  });
});

describe('Plausible route templates', () => {
  const APP_DIR = join(__dirname, '../../app');
  /** The catch-all intercept renders whatever post URL it intercepts, which the post template already covers. */
  const EXEMPT_ROUTES = ['(feeds)/@post/[...catchAll]'];

  function pageDirectories(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return pageDirectories(join(dir, entry.name));
      return entry.name === 'page.tsx' ? [relative(APP_DIR, dir)] : [];
    });
  }

  /** Route groups and slots are not URL segments; an intercept marker such as `(.)` is dropped. */
  function urlSegments(route: string): string[] {
    return route
      .split('/')
      .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
      .map((segment) => segment.replace(/^(?:\(\.{1,3}\))+/, ''));
  }

  it('maps every app route to its route template', () => {
    const routes = pageDirectories(APP_DIR).filter((route) => !EXEMPT_ROUTES.includes(route));
    expect(routes.some((route) => route.includes('['))).toBe(true);

    const mismatches = routes.flatMap((route) => {
      const segments = urlSegments(route);
      const sample = segments.map((segment, i) => (segment.startsWith('[') ? `sample-${i}` : segment));
      const expected = `/${segments.map((segment) => (segment.startsWith('[') ? ':' : segment)).join('/')}`;
      const actual = plausiblePageUrlFromHref(`${ORIGIN}/${sample.join('/')}`)
        .slice(ORIGIN.length)
        .replace(/\/:[A-Za-z]+/g, '/:');
      return actual === expected ? [] : [`${route}: ${actual} (expected ${expected})`];
    });
    expect(mismatches).toEqual([]);
  });

  it('lists only exemptions that exist', () => {
    const routes = pageDirectories(APP_DIR);
    for (const route of EXEMPT_ROUTES) expect(routes).toContain(route);
  });
});
