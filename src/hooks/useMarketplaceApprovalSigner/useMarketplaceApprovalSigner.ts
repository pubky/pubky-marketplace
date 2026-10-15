'use client';

import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import type { GrantSigner } from '@/stores/auth/auth.types';

export type MarketplaceApprovalSigner = 'Bitkit' | 'Pubky Passport' | 'Pubky Ring' | 'your signer';
export type MarketplaceSignerChoice = 'ring' | 'bitkit' | 'passport';

/** A hosted grant or imported recovery key does not identify an external signer. */
export function marketplaceSignerChoice(grantSigner: GrantSigner | null): MarketplaceSignerChoice | null {
  return grantSigner === 'ring' || grantSigner === 'bitkit' || grantSigner === 'passport' ? grantSigner : null;
}

export function marketplaceApprovalSigner(grantSigner: GrantSigner | null): MarketplaceApprovalSigner {
  if (grantSigner === 'passport') return 'Pubky Passport';
  if (grantSigner === 'bitkit') return 'Bitkit';
  if (grantSigner === 'ring') return 'Pubky Ring';
  return 'your signer';
}

export function useMarketplaceApprovalSigner(): MarketplaceApprovalSigner {
  return marketplaceApprovalSigner(useGrantSigner());
}
