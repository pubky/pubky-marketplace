import { isTrustedMarketplaceAttestor } from '@/config/commerce';

/**
 * How many verified reviews in a reputation aggregate come from attestors
 * this client trusts. The index's own `verifiedCount` counts any valid
 * signature from any key (a self-made key counts), so every user-visible
 * "verified" figure is derived from the per-attestor breakdown instead.
 */
export function trustedAttestedReviewCount(attestors: Record<string, number>): number {
  return Object.entries(attestors)
    .filter(([attestorId]) => isTrustedMarketplaceAttestor(attestorId))
    .reduce((total, [, count]) => total + count, 0);
}
