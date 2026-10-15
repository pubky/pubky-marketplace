'use client';

import { Typography } from '@/atoms/Typography/Typography';
import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import type { GrantSigner } from '@/stores/auth/auth.types';

export type GrantSessionRefusalReason = 'default';

/**
 * What a grant sign-in reads where the Shop cannot serve it yet: it says what
 * is missing and that the rest of Shop works. Chat has its own notice.
 */
export function grantSessionRefusalCopy(_reason: GrantSessionRefusalReason, _signer: GrantSigner): string {
  return 'Marketplace approvals are unavailable on this deployment. Try again when access is enabled.';
}

/** Shown instead of a Pubky Ring approval QR when the Shop session came from a grant sign-in. */
export function GrantSessionRefusal({ reason = 'default' }: { reason?: GrantSessionRefusalReason }) {
  const signer = useGrantSigner() ?? 'bitkit';
  return (
    <div
      role="status"
      data-testid="grant-session-refusal"
      className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
    >
      <Typography as="p" className="text-sm text-muted-foreground">
        {grantSessionRefusalCopy(reason, signer)}
      </Typography>
    </div>
  );
}
