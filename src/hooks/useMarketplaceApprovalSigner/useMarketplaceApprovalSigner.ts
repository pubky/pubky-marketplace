'use client';

import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import type { GrantSigner } from '@/stores/auth/auth.types';

export type MarketplaceApprovalSigner = 'Bitkit' | 'Pubky Passport' | 'Pubky Ring' | 'your signer';
export type MarketplaceSignerChoice = 'ring' | 'bitkit' | 'passport';

/**
 * A hosted grant or imported recovery key does not identify an external signer.
 * A sign-in QR scanned by Pubky Ring or Bitkit starts on Pubky Ring: both approve
 * the same link, and the dialog's signer toggle switches the app a phone opens.
 */
export function marketplaceSignerChoice(grantSigner: GrantSigner | null): MarketplaceSignerChoice | null {
  if (grantSigner === 'unknown') return 'ring';
  return grantSigner === 'ring' || grantSigner === 'bitkit' || grantSigner === 'passport' ? grantSigner : null;
}

export function marketplaceApprovalSigner(grantSigner: GrantSigner | null): MarketplaceApprovalSigner {
  const choice = marketplaceSignerChoice(grantSigner);
  if (choice === 'passport') return 'Pubky Passport';
  if (choice === 'bitkit') return 'Bitkit';
  if (choice === 'ring') return 'Pubky Ring';
  return 'your signer';
}

export function useMarketplaceApprovalSigner(): MarketplaceApprovalSigner {
  return marketplaceApprovalSigner(useGrantSigner());
}
