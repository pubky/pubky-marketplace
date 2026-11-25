/** Matches the service's registration grace after the payment window. */
export const LOCKS_REGISTRATION_GRACE_SECONDS = 600;

export const LOCKS_TASK_LIVE_REFUSAL_REASON = 'locks_task_live';

export const LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY =
  'Cancelling is paused while this payment is still in progress. You can cancel it once the payment has finished or its payment time has ended.';

interface LocksCancelPausedMessageOptions {
  holdExpiresAt: string | null | undefined;
  /** True when the saved payment is registered, or when registration is unknown. */
  registered: boolean;
  now?: number;
  locale?: string;
  timeZone?: string;
}

/**
 * Buyer copy for a paused cancellation. The order hold gives a time only when
 * this device saved a payment that is known not to be registered. For a
 * registered payment, or when registration is unknown (no saved payment, failed
 * read), a live task can end earlier or later than the hold, so no time is stated.
 */
export function locksCancelPausedMessage({
  holdExpiresAt,
  registered,
  now = Date.now(),
  locale,
  timeZone,
}: LocksCancelPausedMessageOptions): string {
  const holdEnd = holdExpiresAt === null || holdExpiresAt === undefined ? Number.NaN : Date.parse(holdExpiresAt);
  const cancelAt = holdEnd + LOCKS_REGISTRATION_GRACE_SECONDS * 1_000;
  if (!registered && Number.isFinite(holdEnd) && cancelAt > now) {
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
    return `Cancelling is paused while this payment is still in progress. The earliest you can cancel it is ${time}.`;
  }

  // A registered payment can stay active under a configurable service hold,
  // so the order hold cannot provide an honest end time.
  return LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY;
}
