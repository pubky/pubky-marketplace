import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilitiesMatchFullGrant } from '@/libs/auth/capabilities';
import ringCookie from '@/test/fixtures/auth/ring-cookie-signin.pubky-common-0.11.json';
import {
  CAPABILITIES,
  capabilitiesMatchRingCookieGrant,
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

  it('accepts the exact CAPABILITIES set', () => {
    expect(capabilitiesMatchFullGrant(full)).toBe(true);
  });

  it('accepts a reordered full grant', () => {
    expect(capabilitiesMatchFullGrant([...full].reverse())).toBe(true);
  });

  it('accepts root and broader subtree permissions, including separate action grants', () => {
    expect(capabilitiesMatchFullGrant(['/:rw'])).toBe(true);
    expect(capabilitiesMatchFullGrant(['/pub/:r', '/pub/:w', '/priv/:rw'])).toBe(true);
    expect(capabilitiesMatchFullGrant(['/pub/:r', '/priv/:rw'])).toBe(false);
    expect(capabilitiesMatchFullGrant(['/pub/pubky.app/foo:rw', '/pub/paykit/:rw', '/priv/pubky.app/:rw'])).toBe(false);
  });

  it('refuses empty capabilities', () => {
    expect(capabilitiesMatchFullGrant([])).toBe(false);
  });

  it('does not treat file paths as subtree permissions', () => {
    expect(capabilitiesMatchFullGrant(['/pub:rw', '/priv:rw'])).toBe(false);
    expect(capabilitiesMatchFullGrant(['/pub/pubky.app:rw', '/pub/paykit/:rw', '/priv/pubky.app/:rw'])).toBe(false);
  });

  it('rejects an entire malformed capability list using the SDK parser', () => {
    expect(capabilitiesMatchFullGrant(['/:rw', 'malformed'])).toBe(false);
    expect(capabilitiesMatchFullGrant(['/:rw', '/pub/:invalid'])).toBe(false);
    expect(capabilitiesMatchFullGrant(['/:wr'])).toBe(true);
  });

  it('refuses missing permissions but accepts additional scopes', () => {
    expect(capabilitiesMatchFullGrant(full.slice(0, 2))).toBe(false);
    expect(capabilitiesMatchFullGrant([...full, '/extra/:rw'])).toBe(true);
  });

  it('reuses existing core Shop grants without requiring optional Chat permissions', () => {
    const coreGrant = ['/pub/pubky.app/:rw', '/pub/paykit/:rw', '/priv/pubky.app/:rw'];
    expect(capabilitiesMatchFullGrant(coreGrant)).toBe(true);
    expect(capabilitiesMatchFullGrant([...coreGrant, '/pub/chat/v0/:rw'])).toBe(true);
    expect(capabilitiesMatchFullGrant([...coreGrant, '/priv/chat/v0/:r'])).toBe(true);
    expect(capabilitiesMatchFullGrant(RING_COOKIE_CAPABILITIES.split(','))).toBe(true);
    expect(capabilitiesMatchFullGrant(['/pub/pubky.app/:rw', '/pub/chat/v0/:rw', '/priv/chat/v0/:rw'])).toBe(false);
  });

  it('requests exactly the agreed Shop and Chat v0 permissions for new approvals', () => {
    expect(CAPABILITIES).toBe(
      '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw',
    );
  });
});

describe('RING_COOKIE_CAPABILITIES', () => {
  const entries = (capabilities: string) => capabilities.split(',');

  it("preserves the legacy verifier's scopes independently of new grant permissions", () => {
    const legacyShop = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw';
    const union = new Set([...entries(legacyShop), ...entries(ringCookie.pubky_app_signin)]);
    expect(new Set(entries(RING_COOKIE_CAPABILITIES))).toEqual(union);
    expect(entries(RING_COOKIE_CAPABILITIES)).toHaveLength(union.size);
  });

  it('matches the historical token fixture consumed by the legacy verifier', () => {
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
