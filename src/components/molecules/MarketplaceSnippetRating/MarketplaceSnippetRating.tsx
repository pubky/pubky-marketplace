'use client';

import { Typography } from '@/atoms/Typography/Typography';
import { useAttestorKeyWindowsVersion } from '@/hooks/useAttestorKeyWindows/useAttestorKeyWindows';
import { countedSnippetReputation } from '@/libs/commerce/review-counting';
import { cn } from '@/libs/utils/utils';
import type { CommerceReputationSnippet } from '@/models/commerce/commerce.schema';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceSnippetRatingProps {
  snippet: CommerceReputationSnippet;
  /** Classes for the "No rating yet" line when nothing is counted. */
  emptyClassName?: string;
}

/**
 * A listing's stars from counted reviews only, as a per-buyer mean with its
 * buyers and orders: the index's exact scoped figure when the read carried
 * one, else the trusted buckets (card rule: a bucket a trust window cuts adds
 * nothing). A snippet from an index without buckets keeps the index's stars
 * and count, with no counted claim. The figure depends on the trust list, so
 * the card renders again when an attestor's profile narrows it.
 */
export function MarketplaceSnippetRating({ snippet, emptyClassName }: MarketplaceSnippetRatingProps) {
  useAttestorKeyWindowsVersion();
  const counted = countedSnippetReputation(snippet);
  if (counted === null) return <MarketplaceStarRating rating={snippet.avg} count={snippet.count} size="sm" />;
  if (counted.itemRating === null) {
    return (
      <Typography as="p" className={cn('text-xs text-secondary-foreground', emptyClassName)}>
        No rating yet
      </Typography>
    );
  }
  return <MarketplaceStarRating rating={counted.itemRating} basis={counted} size="sm" />;
}
