// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Env } from '@/libs/env/env';
import { GET } from './route';

const enter = (segments: string[], query = '', headers: HeadersInit = {}) =>
  GET(new Request('https://shop.example/some-path' + query, { headers }), { params: Promise.resolve({ segments }) });

describe('retired social route handoff', () => {
  const originalBasePath = Env.NEXT_PUBLIC_BASE_PATH;
  const originalHost = Env.NEXT_PUBLIC_SOCIAL_HOST;
  afterEach(() => {
    Env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    Env.NEXT_PUBLIC_SOCIAL_HOST = originalHost;
  });

  it('canonicalizes a legacy profile link and keeps repeated query values', async () => {
    Env.NEXT_PUBLIC_BASE_PATH = '';
    Env.NEXT_PUBLIC_SOCIAL_HOST = 'https://social.example';
    const result = await enter(['profile', 'abc', 'posts'], '?tag=a&tag=b');
    expect(result.status).toBe(307);
    expect(result.headers.get('location')).toBe('https://social.example/profile/abc?tag=a&tag=b');
  });

  it('stops a root-mounted Shop from redirecting back to itself', async () => {
    Env.NEXT_PUBLIC_BASE_PATH = '';
    Env.NEXT_PUBLIC_SOCIAL_HOST = 'https://shop.example';
    const response = await enter(['profile']);
    expect(response.status).toBe(503);
    expect(response.headers.has('location')).toBe(false);
  });

  it('hands the frame back to the same-origin App at its root', async () => {
    Env.NEXT_PUBLIC_BASE_PATH = '/shop-embed';
    Env.NEXT_PUBLIC_SOCIAL_HOST = undefined;
    const result = await enter(['settings', 'edit'], '?tab=a&other=1', { 'sec-fetch-dest': 'iframe' });
    expect(result.status).toBe(200);
    const html = await result.text();
    expect(html).toContain('href="/settings/edit?tab=a&amp;other=1" target="_top"');
    expect(html).toContain('src="/shop-embed/social-handoff.js"');
  });

  it('serves direct mounted visits without placing the mount on the App path', async () => {
    Env.NEXT_PUBLIC_BASE_PATH = '/shop-embed';
    Env.NEXT_PUBLIC_SOCIAL_HOST = undefined;
    expect((await enter(['home'], '', { 'sec-fetch-dest': 'document' })).headers.get('location')).toBe('/home');
  });

  it('hands standalone or self-hosted subpath deployments to the canonical App by default', async () => {
    Env.NEXT_PUBLIC_BASE_PATH = '/store';
    Env.NEXT_PUBLIC_SOCIAL_HOST = undefined;
    expect((await enter(['share'], '?url=a', { 'sec-fetch-dest': 'document' })).headers.get('location')).toBe(
      'https://pubky.app/share?url=a',
    );
  });

  it.each([['marketplace'], ['sign-in'], ['profile', '..'], ['profile', '//evil.example'], ['home', 'extra']])(
    'declines an unsupported handoff %s',
    async (...segments) => {
      expect((await enter(segments)).status).toBe(404);
    },
  );
});
