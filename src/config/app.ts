import { getHomeserver } from '@/config/network';
import { Env } from '@/libs/env/env';
import {
  getPrivEncryptionKeysEnabled,
  getPrivEncryptionKeysHomeservers,
  getShopGrantClientIdOverride,
} from '@/libs/runtime-config/runtime-config';

export const APP_VERSION = Env.NEXT_PUBLIC_APP_VERSION;

/** Minimum storage permissions needed to open Shop with an existing grant. */
export const CORE_CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw';

/** New approvals also cover Chat v0; signer-derived encryption keys are requested only by {@link KEYED_CAPABILITIES}. */
export const CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw';

/**
 * The Shop's scope for scoped encryption keys (priv-encryption Phase 4):
 * read, write and the `e` action on the Shop's own private tree only. `e` is
 * on no other scope, and `/priv/pubky.app/` stays `rw` so the key file and
 * the encrypted records sit under a scope that already exists today.
 */
export const PRIV_KEYS_SCOPE = '/priv/pubky.app/marketplace/:rwe';

/**
 * What a signer approves for {@link PRIV_KEYS_SCOPE} when the user declines
 * `e` but approves storage; the approval then carries no keys.
 */
export const PRIV_KEYS_SCOPE_DECLINED = '/priv/pubky.app/marketplace/:rw';

/** The grant sign-in request when scoped encryption keys are asked for. */
export const KEYED_CAPABILITIES = `${CAPABILITIES},${PRIV_KEYS_SCOPE}`;

/**
 * Whether the grant sign-in asks the signer for `e`: the runtime switch is on
 * and the deploy's homeserver is listed as running scoped keys. The
 * homeserver does not advertise the capability, and one that predates it
 * rejects the whole grant after the user approved, so both must hold.
 */
export function isPrivKeysRequested(): boolean {
  return getPrivEncryptionKeysEnabled() && getPrivEncryptionKeysHomeservers().includes(getHomeserver());
}

/** Default client id signers show on their approval screen for the Shop's grant sign-in. */
export const SHOP_GRANT_CLIENT_ID = 'shop.pubky.app';

/** The client id in use: runtime deployment override or the standalone Shop default. */
export function getShopGrantClientId(): string {
  return getShopGrantClientIdOverride() ?? SHOP_GRANT_CLIENT_ID;
}

/** Legacy messaging protocol scopes; never used for Shop homeserver sign-in. */
export const RING_COOKIE_CAPABILITIES =
  '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/priv/social/:rw,/priv/app.locks/content/:r';

/** Legacy identity-only AuthToken verifiers still use exact scopes. */
export function capabilitiesMatchRingCookieGrant(capabilities: readonly string[]): boolean {
  const expected = RING_COOKIE_CAPABILITIES.split(',');
  const incoming = new Set(capabilities.map((entry) => entry.trim()));
  return incoming.size === expected.length && expected.every((entry) => incoming.has(entry));
}
