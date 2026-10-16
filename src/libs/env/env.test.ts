import { describe, expect, it } from 'vitest';
import { Env, envSchema } from './env';

/**
 * Tests for the build-time environment schema.
 *
 * Only build-intrinsic public values and server-only variables live in `Env`. Everything
 * runtime-configurable is covered by src/libs/runtime-config/runtime-config.schema.test.ts.
 */
describe('Environment variables configuration', () => {
  it('should transform boolean strings correctly', () => {
    expect(typeof Env.NEXT_PUBLIC_DEBUG_MODE).toBe('boolean');
  });

  it('should transform number strings correctly', () => {
    expect(typeof Env.NEXT_PUBLIC_DB_VERSION).toBe('number');
  });

  it('should expose the build-intrinsic values set by the test config', () => {
    expect(Env.NEXT_PUBLIC_DB_NAME).toBeDefined();
    expect(Env.NEXT_PUBLIC_APP_VERSION).toBe('0.0.0-test');
  });

  it('should expose server-only Chatwoot credentials from the test config', () => {
    expect(Env.BASE_URL_SUPPORT).toBeDefined();
    expect(Env.SUPPORT_API_ACCESS_TOKEN).toBeDefined();
    expect(Env.SUPPORT_ACCOUNT_ID).toBeDefined();
  });
});

describe('social link-out env schema', () => {
  const required = { NEXT_PUBLIC_APP_VERSION: '1.0.0' };

  it('defaults to off in the test config', () => {
    expect(Env.NEXT_PUBLIC_SOCIAL_HOST).toBeUndefined();
  });

  it('treats an unset or empty host as off', () => {
    const unset = envSchema.safeParse(required);
    const empty = envSchema.safeParse({ ...required, NEXT_PUBLIC_SOCIAL_HOST: '' });
    expect(unset.success && unset.data.NEXT_PUBLIC_SOCIAL_HOST).toBeUndefined();
    expect(empty.success && empty.data.NEXT_PUBLIC_SOCIAL_HOST).toBeUndefined();
  });

  it('accepts an exact https origin', () => {
    const result = envSchema.safeParse({
      ...required,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SOCIAL_HOST: 'https://staging.pubky.app',
    });
    expect(result.success && result.data.NEXT_PUBLIC_SOCIAL_HOST).toBe('https://staging.pubky.app');
  });

  it.each(['https://pubky.app/', 'pubky.app', 'http://localhost:3000'])('fails a production parse for %s', (value) => {
    expect(envSchema.safeParse({ ...required, NODE_ENV: 'production', NEXT_PUBLIC_SOCIAL_HOST: value }).success).toBe(
      false,
    );
  });
});

describe('mount path env schema', () => {
  const required = { NEXT_PUBLIC_APP_VERSION: '1.0.0' };

  it('defaults to the origin root and the Shop-namespaced database name', () => {
    const result = envSchema.safeParse(required);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_BASE_PATH).toBe('');
      expect(result.data.NEXT_PUBLIC_ASSET_PREFIX).toBeUndefined();
      expect(result.data.NEXT_PUBLIC_DB_NAME).toBe('shop-franky');
    }
  });

  it('exposes an unset mount path in the default test config', () => {
    expect(Env.NEXT_PUBLIC_BASE_PATH).toBe('');
    expect(Env.NEXT_PUBLIC_ASSET_PREFIX).toBeUndefined();
  });

  it('treats blank values as unset', () => {
    const result = envSchema.safeParse({ ...required, NEXT_PUBLIC_BASE_PATH: '  ', NEXT_PUBLIC_ASSET_PREFIX: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_BASE_PATH).toBe('');
      expect(result.data.NEXT_PUBLIC_ASSET_PREFIX).toBeUndefined();
    }
  });

  it('accepts a mount path and an asset prefix', () => {
    const result = envSchema.safeParse({
      ...required,
      NEXT_PUBLIC_BASE_PATH: '/shop',
      NEXT_PUBLIC_ASSET_PREFIX: 'https://cdn.example.com/shop',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_BASE_PATH).toBe('/shop');
      expect(result.data.NEXT_PUBLIC_ASSET_PREFIX).toBe('https://cdn.example.com/shop');
    }
  });

  it.each(['/', '/shop/', 'shop', '/a/../b', '/shop?x=1'])('rejects the mount path %s', (value) => {
    expect(envSchema.safeParse({ ...required, NEXT_PUBLIC_BASE_PATH: value }).success).toBe(false);
  });

  it.each(['/shop-static/', 'cdn.example.com', 'https://cdn.example.com/'])('rejects the asset prefix %s', (value) => {
    expect(envSchema.safeParse({ ...required, NEXT_PUBLIC_ASSET_PREFIX: value }).success).toBe(false);
  });
});
