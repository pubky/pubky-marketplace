import { Env } from '@/libs/env/env';

export const APP_VERSION = Env.NEXT_PUBLIC_APP_VERSION;

/** Required Shop storage permissions. No signer-derived encryption keys are requested. */
export const CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw';

/** Client id signers show on their approval screen for the Shop's grant sign-in. */
export const SHOP_GRANT_CLIENT_ID = 'shop.pubky.app';

/** Legacy messaging protocol scopes; never used for Shop homeserver sign-in. */
export const RING_COOKIE_CAPABILITIES =
  '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/priv/social/:rw,/priv/app.locks/content/:r';

/** Legacy identity-only AuthToken verifiers still use exact scopes. */
export function capabilitiesMatchRingCookieGrant(capabilities: readonly string[]): boolean {
  const expected = RING_COOKIE_CAPABILITIES.split(',');
  const incoming = new Set(capabilities.map((entry) => entry.trim()));
  return incoming.size === expected.length && expected.every((entry) => incoming.has(entry));
}
