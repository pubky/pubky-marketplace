import { isAppError } from '@/libs/error/error.utils';

export const BROWSER_STORAGE_BLOCKED_MESSAGE = 'Browser storage is blocked. Enable storage to sign in securely.';

export const GRANT_STORAGE_UNAVAILABLE_MESSAGE =
  "This browser can't save a secure sign-in. Leave private browsing or allow this site to store data, then try again.";

export const FULL_GRANT_REQUIRED_MESSAGE =
  'This approval does not include the full Shop permission list. Approve again from Shop.';

export const HOSTED_SIGN_IN_MESSAGE = 'Continue sign-in in Pubky App.';

export const SIGN_IN_LINK_FAILED_MESSAGE =
  'Could not create the sign-in code. Check your internet connection, then select "Click to reload" to try again.';

export const SIGN_IN_FAILED_MESSAGE =
  'Sign-in could not be completed. Check your internet connection, then select "Click to reload" to try again.';

export const SIGN_IN_FAILED_RETRY_MESSAGE =
  'Sign-in could not be completed. Check your internet connection, then try again.';

/** Shop-written sign-in errors whose message tells the user what to do next. */
const ACTIONABLE_SIGN_IN_MESSAGES: ReadonlySet<string> = new Set([
  BROWSER_STORAGE_BLOCKED_MESSAGE,
  GRANT_STORAGE_UNAVAILABLE_MESSAGE,
  FULL_GRANT_REQUIRED_MESSAGE,
  HOSTED_SIGN_IN_MESSAGE,
]);

/**
 * Copy for a failed sign-in step. Only the Shop's own actionable messages are shown as-is:
 * any other AppError may carry a raw SDK or homeserver string (see `handleError`).
 */
export function signInErrorCopy(error: unknown, fallback: string): string {
  return isAppError(error) && ACTIONABLE_SIGN_IN_MESSAGES.has(error.message) ? error.message : fallback;
}
