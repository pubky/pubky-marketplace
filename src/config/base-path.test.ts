import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBasePath } from '@/test-utils/base-path';
import {
  getBasePath,
  getShopBaseUrl,
  getShopPublicPath,
  withBasePath,
  withoutBasePath,
  withPublicPath,
} from './base-path';

const runtime = vi.hoisted(() => ({ publicPath: undefined as string | undefined }));

vi.mock('@/config/metadata', () => ({ getDefaultUrl: () => 'https://pubky.app' }));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getShopPublicPathOverride: () => runtime.publicPath };
});

describe('base path config', () => {
  afterEach(() => {
    setBasePath('');
    runtime.publicPath = undefined;
  });

  it('serves from the origin root by default', () => {
    expect(getBasePath()).toBe('');
    expect(withBasePath('/api/feedback')).toBe('/api/feedback');
    expect(withoutBasePath('/marketplace')).toBe('/marketplace');
    expect(getShopBaseUrl()).toBe('https://pubky.app');
    expect(getShopPublicPath()).toBe('');
    expect(withPublicPath('/marketplace/listing/a/b')).toBe('/marketplace/listing/a/b');
  });

  it('prefixes paths and builds the public URL under a mount path', () => {
    setBasePath('/shop');
    expect(getBasePath()).toBe('/shop');
    expect(withBasePath('/api/feedback')).toBe('/shop/api/feedback');
    expect(withoutBasePath('/shop/marketplace')).toBe('/marketplace');
    expect(getShopBaseUrl()).toBe('https://pubky.app/shop');
  });

  it('shares the mount path as the public path when no public path is configured', () => {
    setBasePath('/shop');
    expect(getShopPublicPath()).toBe('/shop');
    expect(withPublicPath('/marketplace/listing/a/b')).toBe('/shop/marketplace/listing/a/b');
  });

  describe('when the App owns /shop and frames the build mounted at /shop-embed', () => {
    it('keeps assets and API calls on the mount path and points people at the public path', () => {
      setBasePath('/shop-embed');
      runtime.publicPath = '/shop';
      expect(withBasePath('/api/marketplace/grant')).toBe('/shop-embed/api/marketplace/grant');
      expect(withBasePath('/images/logo.svg')).toBe('/shop-embed/images/logo.svg');
      expect(getShopPublicPath()).toBe('/shop');
      expect(withPublicPath('/marketplace/listing/a/b')).toBe('/shop/marketplace/listing/a/b');
      expect(getShopBaseUrl()).toBe('https://pubky.app/shop');
    });

    it('leaves a path that already carries the public path, and absolute URLs, alone', () => {
      setBasePath('/shop-embed');
      runtime.publicPath = '/shop';
      expect(withPublicPath('/shop/marketplace/orders')).toBe('/shop/marketplace/orders');
      expect(withPublicPath('https://paypal.example/checkout')).toBe('https://paypal.example/checkout');
    });
  });

  it('can serve a standalone build at the origin root while a public path is set', () => {
    runtime.publicPath = '/shop';
    expect(withBasePath('/api/feedback')).toBe('/api/feedback');
    expect(withPublicPath('/profile/abc')).toBe('/shop/profile/abc');
  });
});
