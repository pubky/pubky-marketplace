import { Env } from '@/libs/env/env';
import { getShopGrantClientIdOverride } from '@/libs/runtime-config/runtime-config';

export const APP_VERSION = Env.NEXT_PUBLIC_APP_VERSION;

/** Minimum storage permissions needed to open Shop with an existing grant. */
export const CORE_CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw';

/** New approvals also cover Chat v0; no signer-derived encryption keys are requested. */
/**
 * The chat trees, versioned so the Shop neither writes the shared chat
 * library's planned `/pub/chat/v1/` nor exposes its key to apps holding it.
 * Requested at sign-in; optional for opening the Shop (docs/chat).
 */
export const CHAT_CAPABILITIES = '/pub/chat/v0/:rw,/priv/chat/v0/:rw';

export const CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw';

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
