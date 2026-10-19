import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIosUserAgent, toBitkitIosSignInUrl, toSignerDeepLink } from './bitkit-ios-url';

const GRANT_URL = 'pubkyauth://signin_grant?caps=x&relay=r&secret=s&cid=shop.pubky.app&cpk=k';

describe('toBitkitIosSignInUrl', () => {
  it('maps a grant sign-in to the bitkit link with the same query', () => {
    expect(toBitkitIosSignInUrl(GRANT_URL)).toBe(
      'bitkit://pubky-auth/signin?caps=x&relay=r&secret=s&cid=shop.pubky.app&cpk=k',
    );
  });

  it.each([
    ['legacy Ring sign-in', 'pubkyauth://signin?caps=x&secret=s'],
    ['grant sign-in without a query', 'pubkyauth://signin_grant?'],
    ['web url', 'https://shop.pubky.app/'],
  ])('leaves a %s unchanged', (_, url) => {
    expect(toBitkitIosSignInUrl(url)).toBe(url);
  });
});

describe('isIosUserAgent', () => {
  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5, true],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5, true],
    ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', 5, true],
    ['iPadOS as Macintosh with touch', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5, true],
    ['Mac without touch', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0, false],
    ['Android', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile', 5, false],
  ])('%s -> %s', (_, userAgent, maxTouchPoints, expected) => {
    expect(isIosUserAgent({ userAgent, maxTouchPoints })).toBe(expected);
  });

  it('is false without a navigator', () => {
    expect(isIosUserAgent(undefined)).toBe(false);
  });
});

describe('toSignerDeepLink', () => {
  const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 };
  const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile', maxTouchPoints: 5 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the bitkit link for Bitkit on iOS', () => {
    vi.stubGlobal('navigator', IPHONE);
    expect(toSignerDeepLink(GRANT_URL, 'bitkit')).toBe(toBitkitIosSignInUrl(GRANT_URL));
  });

  it.each([
    ['Pubky Ring on iOS', IPHONE, 'ring'],
    ['no signer on iOS', IPHONE, null],
    ['Bitkit on Android', ANDROID, 'bitkit'],
  ] as const)('keeps the url for %s', (_, nav, signer) => {
    vi.stubGlobal('navigator', nav);
    expect(toSignerDeepLink(GRANT_URL, signer)).toBe(GRANT_URL);
  });
});
