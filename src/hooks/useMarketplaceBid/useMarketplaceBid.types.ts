import { z } from 'zod';

/**
 * The lowest maximum the service accepts, mirroring its `personal_minimum_next_bid`.
 * With no bid standing the visible price is the starting bid, not a bid to
 * beat, so the opening bid may equal it; once a bid stands the floor is the
 * visible price plus the increment, and a bidder's own earlier maximum can only
 * raise it.
 */
export function marketplaceBidMinimum(
  currentPriceMinor: number,
  minimumIncrementMinor: number,
  bidCount: number,
  viewerMinimumMinor?: number,
): number {
  const visibleFloor = bidCount === 0 ? currentPriceMinor : currentPriceMinor + minimumIncrementMinor;
  return Math.max(visibleFloor, viewerMinimumMinor ?? 0);
}

export const marketplaceBidSchema = z.object({
  maximumAmount: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid maximum bid.')
    .refine((value) => Number(value) > 0, 'Maximum bid must be greater than zero.'),
});

export type MarketplaceBidData = z.infer<typeof marketplaceBidSchema>;

export const marketplaceBidDefaults: MarketplaceBidData = {
  maximumAmount: '',
};
