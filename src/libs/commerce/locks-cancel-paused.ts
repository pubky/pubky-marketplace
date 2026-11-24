/** Matches the service's registration grace after the payment window. */
export const LOCKS_REGISTRATION_GRACE_SECONDS = 600;

export const LOCKS_TASK_LIVE_REFUSAL_REASON = 'locks_task_live';

export const LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY =
  'Cancelling is paused while this payment is still in progress. You can cancel it once the payment has finished or its payment time has ended.';

interface LocksCancelPausedMessageOptions {
  windowExpiresAt: string | null;
  registered: boolean;
  now?: number;
  locale?: string;
  timeZone?: string;
}

/** Buyer copy for a cancellation the service paused while a Locks payment is active. */
export function locksCancelPausedMessage({
  windowExpiresAt,
  registered,
  now = Date.now(),
  locale,
  timeZone,
}: LocksCancelPausedMessageOptions): string {
  const windowEnd = windowExpiresAt === null ? Number.NaN : Date.parse(windowExpiresAt);
  const cancelAt = windowEnd + LOCKS_REGISTRATION_GRACE_SECONDS * 1_000;
  if (!registered && Number.isFinite(windowEnd) && cancelAt > now) {
    const dayFormat = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone,
    });
    const sameDay = dayFormat.format(now) === dayFormat.format(cancelAt);
    const time = new Intl.DateTimeFormat(locale, {
      ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(cancelAt);
    return `Cancelling is paused while this payment is being set up. You can cancel it after ${time}.`;
  }

  // A registered payment can stay active under a configurable service hold,
  // so its local payment window cannot provide an honest end time.
  return LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY;
}
