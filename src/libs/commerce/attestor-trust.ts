import { trustedMarketplaceAttestorAt } from '@/config/commerce';

/**
 * How many verified reviews in a reputation aggregate come from attestors
 * this client trusts. The index's own `verifiedCount` counts any valid
 * signature from any key (a self-made key counts), so every user-visible
 * "verified" figure is derived from the per-attestor breakdown instead.
 *
 * The aggregate carries no attestation times, so an attestor counts only
 * while its trust window is open at `now`: a retired key's reviews drop out
 * of the count instead of a compromised key's later ones counting.
 */
export function trustedAttestedReviewCount(attestors: Record<string, number>, now: Date = new Date()): number {
  return Object.entries(attestors)
    .filter(([attestorId]) => trustedMarketplaceAttestorAt(attestorId, now) !== null)
    .reduce((total, [, count]) => total + count, 0);
}
