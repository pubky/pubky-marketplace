/** Matches the service's registration grace after the payment window. */
export const LOCKS_REGISTRATION_GRACE_SECONDS = 600;

/** The service's refusal reason for a cancel while a Locks payment task is still live. */
export const LOCKS_TASK_LIVE_REFUSAL_REASON = 'locks_task_live';

/**
 * The refusal carries no end time, and the Shop's saved payment cannot tell a
 * prepared payment from one registered elsewhere, so the copy states no time.
 */
export const LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY =
  'Cancelling is paused while this payment is still in progress. Try again once it is no longer in progress.';
