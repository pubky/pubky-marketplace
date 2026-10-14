import { afterEach, describe, expect, it, vi } from 'vitest';
import ringCookie from '@/test/fixtures/auth/ring-cookie-signin.pubky-common-0.11.json';
import {
  CAPABILITIES,
  capabilitiesMatchFullGrant,
  capabilitiesMatchRingCookieGrant,
  CHAT_CAPABILITIES,
  CORE_CAPABILITIES,
  getShopGrantClientId,
  RING_COOKIE_CAPABILITIES,
  SHOP_GRANT_CLIENT_ID,
} from './app';

const runtime = vi.hoisted(() => ({ grantClientId: undefined as string | undefined }));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getShopGrantClientIdOverride: () => runtime.grantClientId };
});

describe('getShopGrantClientId', () => {
  afterEach(() => {
    runtime.grantClientId = undefined;
  });

  it('defaults to the built-in client id', () => {
    expect(SHOP_GRANT_CLIENT_ID).toBe('shop.pubky.app');
    expect(getShopGrantClientId()).toBe('shop.pubky.app');
  });

  it('uses the deployer override when one is set', () => {
    runtime.grantClientId = 'staging.pubky.app';
    expect(getShopGrantClientId()).toBe('staging.pubky.app');
  });
});

describe('capabilitiesMatchFullGrant', () => {
  const full = CAPABILITIES.split(',');
  const core = CORE_CAPABILITIES.split(',');

  it('accepts the exact CAPABILITIES set', () => {
    expect(capabilitiesMatchFullGrant(full)).toBe(true);
  });

  it('accepts a reordered full grant', () => {
    expect(capabilitiesMatchFullGrant([...full].reverse())).toBe(true);
  });

  it('accepts the core set alone: chat scopes are optional for opening the Shop', () => {
    expect(capabilitiesMatchFullGrant(core)).toBe(true);
  });

  it('accepts extra entries, such as the App session scopes under /shop-embed', () => {
    expect(capabilitiesMatchFullGrant([...full, '/priv/social/:rw'])).toBe(true);
    expect(capabilitiesMatchFullGrant(RING_COOKIE_CAPABILITIES.split(','))).toBe(true);
  });

  it('refuses empty capabilities', () => {
    expect(capabilitiesMatchFullGrant([])).toBe(false);
  });

  it('refuses a grant missing a core entry', () => {
    expect(capabilitiesMatchFullGrant(core.slice(0, 2))).toBe(false);
    expect(capabilitiesMatchFullGrant(CHAT_CAPABILITIES.split(','))).toBe(false);
  });

  it('keeps the chat scopes versioned and inside the requested grant', () => {
    expect(CHAT_CAPABILITIES).toBe('/pub/chat/v0/:rw,/priv/chat/v0/:rw');
    expect(full).toEqual([...core, ...CHAT_CAPABILITIES.split(',')]);
  });
});

describe('RING_COOKIE_CAPABILITIES', () => {
  const entries = (capabilities: string) => capabilities.split(',');

  it("is exactly the union of the Shop grant and pubky.app's sign-in set", () => {
    const union = new Set([...entries(CAPABILITIES), ...entries(ringCookie.pubky_app_signin)]);
    expect(new Set(entries(RING_COOKIE_CAPABILITIES))).toEqual(union);
    expect(entries(RING_COOKIE_CAPABILITIES)).toHaveLength(union.size);
  });

  it('keeps the Shop grant first, in its own order', () => {
    expect(RING_COOKIE_CAPABILITIES.startsWith(`${CAPABILITIES},`)).toBe(true);
  });

  it('is what the signer is asked for and what the marketplace service stores after normalizing', () => {
    expect(RING_COOKIE_CAPABILITIES).toBe(ringCookie.requested);
    expect(RING_COOKIE_CAPABILITIES).toBe(ringCookie.service_normalized);
  });
});

describe('capabilitiesMatchRingCookieGrant', () => {
  const ring = RING_COOKIE_CAPABILITIES.split(',');

  it('accepts the exact Ring cookie set in any order', () => {
    expect(capabilitiesMatchRingCookieGrant(ring)).toBe(true);
    expect(capabilitiesMatchRingCookieGrant([...ring].reverse())).toBe(true);
    expect(capabilitiesMatchRingCookieGrant(ring.map((entry) => ` ${entry} `))).toBe(true);
  });

  it.each([
    ['empty', []],
    ['the Shop grant alone', CAPABILITIES.split(',')],
    ["pubky.app's own sign-in set", ringCookie.pubky_app_signin.split(',')],
    ['a missing Locks read', ring.filter((entry) => entry !== '/priv/app.locks/content/:r')],
    [
      'a widened Locks entry',
      ring.map((entry) => (entry === '/priv/app.locks/content/:r' ? '/priv/app.locks/:rw' : entry)),
    ],
    ['an extra entry', [...ring, '/:rw']],
  ])('refuses %s', (_label, capabilities) => {
    expect(capabilitiesMatchRingCookieGrant(capabilities)).toBe(false);
  });
});
