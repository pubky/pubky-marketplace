'use client';

import { Typography } from '@/atoms/Typography/Typography';
import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import type { GrantSigner } from '@/stores/auth/auth.types';

const GRANT_SIGNER_NAMES: Record<GrantSigner, string> = {
  bitkit: 'Bitkit',
  passport: 'Pubky Passport',
};

/**
 * What a grant (Bitkit or Pubky Passport) sign-in reads where the Shop cannot
 * serve it yet: it says what is missing and that the rest of Shop works.
 */
export function grantSessionRefusalCopy(signer: GrantSigner): string {
  return `${GRANT_SIGNER_NAMES[signer]} sign-in does not cover this step yet. Sign in with Pubky Ring to continue.`;
}

/** Shown instead of a Pubky Ring approval QR when the Shop session came from a grant sign-in. */
export function GrantSessionRefusal() {
  const signer = useGrantSigner() ?? 'bitkit';
  return (
    <div
      role="status"
      data-testid="grant-session-refusal"
      className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
    >
      <Typography as="p" className="text-sm text-muted-foreground">
        {grantSessionRefusalCopy(signer)}
      </Typography>
    </div>
  );
}
