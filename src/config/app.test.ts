import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilitiesMatchFullGrant } from '@/libs/auth/capabilities';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import {
  LEGACY_SHOP_SIGN_IN_GRANT,
  PREVIOUS_SHOP_SIGN_IN_GRANT,
} from '@/services/marketplace/marketplace-session-grant';
import ringCookie from '@/test/fixtures/auth/ring-cookie-signin.pubky-common-0.11.json';
import {
  CAPABILITIES,
  capabilitiesMatchRingCookieGrant,
  CHAT_CAPABILITIES,
  CORE_CAPABILITIES,
  getShopGrantClientId,
  isPrivKeysRequested,
  KEYED_CAPABILITIES,
  PRIV_KEYS_SCOPE,
  PRIV_KEYS_SCOPE_DECLINED,
  RING_COOKIE_CAPABILITIES,
  SHOP_GRANT_CLIENT_ID,
} from './app';
import { getHomeserver } from './network';

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
    expect(capabilitiesMatchFullGrant(full.slice(1))).toBe(false);
    expect(capabilitiesMatchFullGrant(full.filter((entry) => entry !== '/priv/pubky.app/:rw'))).toBe(false);
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

  it('keeps grants approved before the Shop stopped asking for /pub/paykit/:rw', () => {
    expect(capabilitiesMatchFullGrant(PREVIOUS_SHOP_SIGN_IN_GRANT.split(','))).toBe(true);
    expect(capabilitiesMatchFullGrant([...PREVIOUS_SHOP_SIGN_IN_GRANT.split(','), PRIV_KEYS_SCOPE])).toBe(true);
    expect(capabilitiesMatchFullGrant(LEGACY_SHOP_SIGN_IN_GRANT.split(','))).toBe(true);
  });

  it('requests exactly the agreed Shop and Chat v0 permissions for new approvals', () => {
    expect(CORE_CAPABILITIES).toBe('/pub/pubky.app/:rw,/priv/pubky.app/:rw');
    expect(CAPABILITIES).toBe('/pub/pubky.app/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw');
  });

  it.each([
    ['CORE_CAPABILITIES', CORE_CAPABILITIES],
    ['CAPABILITIES', CAPABILITIES],
    ['KEYED_CAPABILITIES', KEYED_CAPABILITIES],
  ])('%s asks for nothing under /pub/paykit/, which the Shop only reads', (_name, capabilities) => {
    expect(capabilities.split(',').filter((entry) => entry.startsWith('/pub/paykit'))).toEqual([]);
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

describe('CHAT_CAPABILITIES', () => {
  it('keeps the chat scopes versioned and inside the requested grant', () => {
    expect(CHAT_CAPABILITIES).toBe('/pub/chat/v0/:rw,/priv/chat/v0/:rw');
    expect(CAPABILITIES).toBe(`${CORE_CAPABILITIES},${CHAT_CAPABILITIES}`);
  });
});

describe('scoped encryption keys in the grant request', () => {
  it('asks for e on the Shop private tree only, keeping every existing scope', () => {
    expect(PRIV_KEYS_SCOPE).toBe('/priv/pubky.app/marketplace/:rwe');
    expect(KEYED_CAPABILITIES).toBe(`${CAPABILITIES},${PRIV_KEYS_SCOPE}`);
    const withE = KEYED_CAPABILITIES.split(',').filter((entry) => entry.split(':')[1]?.includes('e'));
    expect(withE).toEqual([PRIV_KEYS_SCOPE]);
  });

  it('keeps the Ring cookie set free of e: a cookie session cannot carry keys', () => {
    expect(RING_COOKIE_CAPABILITIES).not.toContain(':rwe');
    expect(RING_COOKIE_CAPABILITIES.split(',').every((entry) => !entry.split(':')[1]?.includes('e'))).toBe(true);
  });

  describe('capabilitiesMatchFullGrant', () => {
    it('accepts a session approved without keys, with keys, and with e declined', () => {
      expect(capabilitiesMatchFullGrant(CAPABILITIES.split(','))).toBe(true);
      expect(capabilitiesMatchFullGrant(KEYED_CAPABILITIES.split(','))).toBe(true);
      expect(capabilitiesMatchFullGrant([...CAPABILITIES.split(','), PRIV_KEYS_SCOPE_DECLINED])).toBe(true);
      expect(capabilitiesMatchFullGrant([...KEYED_CAPABILITIES.split(',')].reverse())).toBe(true);
    });

    it('still refuses a grant whose e scope stands in for a missing core Shop scope', () => {
      expect(capabilitiesMatchFullGrant(KEYED_CAPABILITIES.split(',').slice(1))).toBe(false);
      expect(capabilitiesMatchFullGrant([PRIV_KEYS_SCOPE, '/pub/pubky.app/:rw', '/pub/paykit/:rw'])).toBe(false);
    });
  });

  describe('isPrivKeysRequested', () => {
    beforeEach(() => resetRuntimeConfigForTests());
    afterEach(() => {
      delete process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys];
      delete process.env[PUBKY_RUNTIME_ENV_NAMES.passportPrivEncryptionKeys];
      delete process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers];
      resetRuntimeConfigForTests();
    });

    const HOMESERVER = getHomeserver();
    const listed = () => JSON.stringify([HOMESERVER]);
    const unlisted = () => JSON.stringify(['another-homeserver-key']);

    it('is off by default', () => {
      expect(isPrivKeysRequested()).toBe(false);
      expect(isPrivKeysRequested('passport')).toBe(false);
    });

    it('needs the switch and the deploy homeserver on the list', () => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys] = 'true';
      expect(isPrivKeysRequested()).toBe(false);

      resetRuntimeConfigForTests();
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys] = 'true';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = unlisted();
      expect(isPrivKeysRequested()).toBe(false);

      resetRuntimeConfigForTests();
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys] = 'true';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = listed();
      expect(isPrivKeysRequested()).toBe(true);
    });

    it('stays off when the list names the homeserver but the switch is off', () => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = listed();
      expect(isPrivKeysRequested()).toBe(false);

      resetRuntimeConfigForTests();
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys] = 'false';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = listed();
      expect(isPrivKeysRequested()).toBe(false);
    });

    it('applies the switch for every signer to the Passport sign-in too', () => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeys] = 'true';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = listed();
      expect(isPrivKeysRequested('passport')).toBe(true);
    });

    it('opens e for the Passport sign-in alone with the Passport switch', () => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.passportPrivEncryptionKeys] = 'true';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = listed();
      expect(isPrivKeysRequested('passport')).toBe(true);
      expect(isPrivKeysRequested()).toBe(false);
    });

    it('keeps the Passport switch behind the homeserver list', () => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.passportPrivEncryptionKeys] = 'true';
      expect(isPrivKeysRequested('passport')).toBe(false);

      resetRuntimeConfigForTests();
      process.env[PUBKY_RUNTIME_ENV_NAMES.passportPrivEncryptionKeys] = 'true';
      process.env[PUBKY_RUNTIME_ENV_NAMES.privEncryptionKeysHomeservers] = unlisted();
      expect(isPrivKeysRequested('passport')).toBe(false);
    });
  });
});
