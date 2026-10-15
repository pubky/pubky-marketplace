import { afterEach, describe, expect, it } from 'vitest';
import { PASSPORT_CALLBACK_HTML } from '@/libs/passport/passport-callback';
import { PASSPORT_CALLBACK_PATH } from '@/libs/passport/passport-popup';
import { setBasePath } from '@/test-utils/base-path';
import { GET } from './route';

describe(`GET ${PASSPORT_CALLBACK_PATH}`, () => {
  it('serves the static return page as HTML without a referrer', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toBe(PASSPORT_CALLBACK_HTML);
  });

  it('lives at the path the Passport callbacks name', () => {
    expect(PASSPORT_CALLBACK_PATH).toBe('/auth/passport/return');
  });
});

afterEach(() => setBasePath(''));
it('serves the mounted fallback when the popup cannot message its opener', async () => {
  setBasePath('/shop-embed');
  expect(await GET().text()).toContain('href="/shop-embed/marketplace"');
});
