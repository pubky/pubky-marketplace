import { Env } from '@/libs/env/env';
import { getShopGrantClientIdOverride, getSingleApprovalSignIn } from '@/libs/runtime-config/runtime-config';

export const APP_VERSION = Env.NEXT_PUBLIC_APP_VERSION;

/**
 * The single sign-in grant. One Ring approval covers everything the app does,
 * on purpose: the homeserver keeps ONE session cookie per user per origin, so
 * splitting capabilities across separate approvals means each new approval
 * clobbers the previous session (this broke all pubky.app writes when the
 * paykit-only messaging grant landed — see `messaging-contracts.ts`).
 * Scopes: the app's own tree, the Paykit tree (Bitcoin wallet markers), the
 * app's private tree (cross-device watchlist sync — `/priv/` is enforced
 * private by the homeserver, verified empirically in
 * `docs/ecommerce/watchlist.md`), and the chat trees: `/pub/chat/v0/` holds a
 * user's published chat key and the encrypted messages they send,
 * `/priv/chat/v0/` their private key and conversation index (docs/chat).
 *
 * This is the grant Bitkit approves for client id {@link SHOP_GRANT_CLIENT_ID}.
 * Pubky Ring cookie approvals request {@link RING_COOKIE_CAPABILITIES}, a
 * superset of it.
 */
export const CORE_CAPABILITIES = '/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw';

/**
 * The chat trees, versioned so the Shop neither writes the shared chat
 * library's planned `/pub/chat/v1/` nor exposes its key to apps holding it.
 * Requested at sign-in; a session without them opens the Shop and sees the
 * re-approval notice in Messages (docs/chat).
 */
export const CHAT_CAPABILITIES = '/pub/chat/v0/:rw,/priv/chat/v0/:rw';

export const CAPABILITIES = `${CORE_CAPABILITIES},${CHAT_CAPABILITIES}`;

/** Default client id Bitkit shows on its Authorize screen for the Shop's grant sign-in. */
export const SHOP_GRANT_CLIENT_ID = 'shop.pubky.app';

/** The client id in use: `PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID` when set, else {@link SHOP_GRANT_CLIENT_ID}. */
export function getShopGrantClientId(): string {
  return getShopGrantClientIdOverride() ?? SHOP_GRANT_CLIENT_ID;
}

/**
 * Interim dual-POST ceremony (docs/ecommerce/single-approval.md). Runtime
 * flag (`PUBKY_RUNTIME_SINGLE_APPROVAL_SIGN_IN`, default on): `false`
 * restores `awaitApproval()` sign-in plus empty-capability marketplace
 * connect. Read at call time so a deploy can roll back without a rebuild.
 * Do not roll back by POSTing empty capabilities to `/session`.
 */
export function isSingleApprovalSignInEnabled(): boolean {
  return getSingleApprovalSignIn();
}

/**
 * What a Pubky Ring cookie sign-in requests: {@link CAPABILITIES} plus
 * pubky.app's own sign-in scopes (`/priv/social/:rw` and the Locks guarded
 * read `/priv/app.locks/content/:r`, from pubky.app's
 * `HOMESERVER_CAPABILITIES`). Shop and pubky.app share the one homeserver
 * cookie, so each cookie approval replaces the other site's; requesting both
 * sets keeps a Shop sign-in from stripping pubky.app's access. Every cookie
 * approval the Shop starts (sign-in, sign-up, step-up, bridged commerce
 * connect, messaging enable) requests this string, and the token it yields
 * must carry exactly this set.
 *
 * Grant sign-ins (Bitkit) are bound to the Shop's client id, never share the
 * cookie, and keep requesting and checking {@link CAPABILITIES}.
 */
export const RING_COOKIE_CAPABILITIES = `${CAPABILITIES},/priv/social/:rw,/priv/app.locks/content/:r`;

function capabilitiesMatchSet(capabilities: readonly string[], expectedSet: string): boolean {
  const expected = expectedSet
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const incoming = [...new Set(capabilities.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
  if (incoming.length !== expected.length) return false;
  const incomingSet = new Set(incoming);
  return expected.every((entry) => incomingSet.has(entry));
}

/**
 * Whether a grant session can open the Shop: it holds every entry of
 * {@link CORE_CAPABILITIES}, in any order, with any extras (the App's own
 * scopes, or the chat scopes). Chat checks its own scopes separately and
 * shows a re-approval notice when they are missing, so an App session that
 * predates them still opens the Shop.
 */
export function capabilitiesMatchFullGrant(capabilities: readonly string[]): boolean {
  const held = new Set(capabilities.map((entry) => entry.trim()));
  return CORE_CAPABILITIES.split(',').every((entry) => held.has(entry));
}

/** Order-insensitive set equality with {@link RING_COOKIE_CAPABILITIES} split on commas. */
export function capabilitiesMatchRingCookieGrant(capabilities: readonly string[]): boolean {
  return capabilitiesMatchSet(capabilities, RING_COOKIE_CAPABILITIES);
}
