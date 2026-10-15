const GRANT_SIGN_IN_PREFIX = 'pubkyauth://signin_grant?';
const BITKIT_IOS_SIGN_IN_PREFIX = 'bitkit://pubky-auth/signin?';

type UserAgentSource = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>;

/** iPhone, iPad, iPod, or iPadOS reporting a Macintosh user agent with touch. */
export function isIosUserAgent(nav: UserAgentSource | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const { userAgent, maxTouchPoints } = nav;
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Bitkit's iOS link for a grant sign-in: `bitkit://pubky-auth/signin` with the
 * same query, which Bitkit maps back to `pubkyauth://signin_grant`. Bitkit iOS
 * leaves `pubkyauth://` to Pubky Ring, so on an iPhone with only Bitkit a
 * `pubkyauth://` link reaches no app. Any other URL comes back unchanged.
 */
export function toBitkitIosSignInUrl(url: string): string {
  if (!url.startsWith(GRANT_SIGN_IN_PREFIX)) return url;
  const query = url.slice(GRANT_SIGN_IN_PREFIX.length);
  return query ? `${BITKIT_IOS_SIGN_IN_PREFIX}${query}` : url;
}
