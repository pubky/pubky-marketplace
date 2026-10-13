import { DEFAULT_AUCTION_DURATION_MINUTES } from '@/libs/runtime-config/runtime-config.schema';

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Hyphenated length for a sale-format label: `15-minute`, `1-hour`, `7-day`. */
export function auctionDurationLabel(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}-day`;
  if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}-hour`;
  return `${minutes}-minute`;
}

/** Length for a select option: `15 minutes`, `1 hour`, `7 days`. */
export function auctionDurationOptionLabel(minutes: number): string {
  const [value, unit] =
    minutes % MINUTES_PER_DAY === 0
      ? [minutes / MINUTES_PER_DAY, 'day']
      : minutes % MINUTES_PER_HOUR === 0
        ? [minutes / MINUTES_PER_HOUR, 'hour']
        : [minutes, 'minute'];
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/**
 * The auction length a new listing publishes with: the seller's choice when the
 * deploy offers it, otherwise the first configured length. An unknown or stale
 * draft value can never publish a length the deploy does not offer.
 */
export function resolveAuctionDurationMinutes(selected: string | undefined, offered: readonly number[]): number {
  const chosen = Number(selected);
  if (offered.includes(chosen)) return chosen;
  return offered[0] ?? DEFAULT_AUCTION_DURATION_MINUTES;
}
