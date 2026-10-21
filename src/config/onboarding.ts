/**
 * How long the onboarding store keeps an unconfirmed recovery phrase and secret key in browser
 * storage. When the store loads saved secrets older than this, it drops them before they reach
 * memory and rewrites the stored entry without them.
 */
export const ONBOARDING_SECRETS_TTL_MS = 24 * 60 * 60 * 1000;
