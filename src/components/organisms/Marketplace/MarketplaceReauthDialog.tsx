'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, type LucideIcon, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import type { MarketplaceSignerChoice } from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import { useStepUpReauth } from '@/hooks/useStepUpReauth/useStepUpReauth';
import { Logger } from '@/libs/logger/logger';
import { getPassportSignInEnabled } from '@/libs/runtime-config/runtime-config';
import { MarketplaceApprovalDisclosure } from '@/molecules/MarketplaceApprovalDisclosure/MarketplaceApprovalDisclosure';
import { QrCodeSlot } from '@/molecules/QrCodeSlot/QrCodeSlot';
import { toast } from '@/molecules/Toaster/use-toast';
import { signInApprovalDisclosure } from '@/services/marketplace/marketplace-session-grant';
import { MarketplaceSessionConnectDialog } from './MarketplaceSessionConnectDialog';

/**
 * Who refused: the homeserver (the Shop session's grant cannot write
 * `/priv/pubky.app/`, the `needs_reauth` states) or the marketplace, which
 * would not release the private data key to the current purchase session
 * (the `needs_marketplace_approval` states and the recovery-key export).
 */
export type MarketplaceReauthRefusal = 'homeserver' | 'purchase_session';

type MarketplaceReauthDialogProps = {
  triggerLabel: string;
  triggerVariant?: 'default' | 'secondary' | 'outline';
  triggerIcon?: LucideIcon;
  intent?: 'sync' | 'messages';
  refusal: MarketplaceReauthRefusal;
  onReauthenticated?: () => void | Promise<void>;
};

/** Homeserver permissions and marketplace service permissions have separate owners. */
export function MarketplaceReauthDialog({
  triggerLabel,
  triggerVariant,
  triggerIcon,
  intent,
  refusal,
  onReauthenticated,
}: MarketplaceReauthDialogProps) {
  if (refusal === 'purchase_session') {
    return (
      <MarketplaceSessionConnectDialog
        triggerLabel={triggerLabel}
        triggerVariant={triggerVariant}
        triggerIcon={triggerIcon}
        intent={intent}
        onConnected={onReauthenticated}
      />
    );
  }
  return (
    <HomeserverStepUpDialog
      triggerLabel={triggerLabel}
      triggerVariant={triggerVariant}
      triggerIcon={triggerIcon}
      intent={intent}
      onReauthenticated={onReauthenticated}
    />
  );
}

/**
 * Mirrors the sign-in / session-connect precedent: the `pubkyauth://`
 * authorization URL renders as a QR for a cross-device Pubky Ring scan, and
 * as a deeplink/copy affordance for same-device Ring.
 *
 * Every open starts a FRESH flow and closing cancels it — auth flows are
 * single-use, so a failed or abandoned flow's QR is never shown again. On
 * approval the controller swaps the auth-store session for the widened
 * (superset-grant) one, which is what makes watchlist sync, receipts, and
 * other homeserver writes capable without a reload.
 */
function HomeserverStepUpDialog({
  triggerLabel,
  triggerVariant = 'secondary',
  triggerIcon: TriggerIcon = KeyRound,
  intent,
  onReauthenticated,
}: Omit<MarketplaceReauthDialogProps, 'refusal'>) {
  const [open, setOpen] = useState(false);
  const [signerChoice, setSignerChoice] = useState<MarketplaceSignerChoice | null>(null);
  const reauth = useStepUpReauth({
    signer: signerChoice,
    onReauthenticated: async () => {
      toast({
        title: 'Signed in again with full permissions',
        description: 'Permissions updated for this session.',
      });
      setOpen(false);
      await onReauthenticated?.();
    },
  });

  // Referencing `reauth.start`/`reauth.cancel` directly keeps the effect
  // dependency-stable: both are useCallback-memoized in the hook.
  const { start, cancel } = reauth;
  useEffect(() => {
    if (open) {
      start();
      return;
    }
    cancel();
  }, [open, start, cancel]);

  const approvalDisclosure = reauth.authorizationUrl ? signInApprovalDisclosure(reauth.authorizationUrl) : null;

  const copyUrl = async () => {
    try {
      await reauth.copyAuthUrl();
      toast({ variant: 'info', title: 'Authorization link copied' });
    } catch (error) {
      Logger.error('Failed to copy the re-authentication link', { error });
      toast({ variant: 'error', description: 'Could not copy to clipboard' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" className="rounded-full">
          <TriggerIcon className="size-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover">
        <DialogHeader>
          <DialogTitle>
            {intent === 'sync' ? 'Enable device sync' : intent === 'messages' ? 'Enable messages' : 'Sign in again'}
          </DialogTitle>
        </DialogHeader>

        <Typography as="p" className="text-sm text-muted-foreground">
          {intent === 'sync'
            ? 'Authorize with your keychain to sync your watchlist across devices and enable selling and buying.'
            : intent === 'messages'
              ? 'Approve the chat storage scopes with your keychain to send and receive messages on this device.'
              : 'Sign in again for this device.'}
        </Typography>

        {reauth.status === 'awaiting-host' ? (
          <Typography as="p" role="status" className="text-sm text-muted-foreground">
            Continue in Pubky App to approve the permissions Shop needs.
          </Typography>
        ) : reauth.requiresSignerChoice ? (
          <div className="grid gap-2">
            <Typography as="p" className="text-sm text-muted-foreground">
              Choose the signer that holds this pubky.
            </Typography>
            <Button onClick={() => setSignerChoice('ring')}>Pubky Ring</Button>
            <Button onClick={() => setSignerChoice('bitkit')}>Bitkit</Button>
            {getPassportSignInEnabled() && <Button onClick={() => setSignerChoice('passport')}>Pubky Passport</Button>}
          </div>
        ) : reauth.status === 'error' ? (
          <div className="grid gap-3">
            <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
              {reauth.errorMessage}
            </div>
            <Button
              className="w-fit rounded-full"
              onClick={() => {
                reauth.start();
                if (reauth.requestsPassport) reauth.startPassport();
              }}
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        ) : reauth.requestsPassport ? (
          <Button onClick={reauth.startPassport} disabled={reauth.status !== 'idle'}>
            Continue in Pubky Passport
          </Button>
        ) : (
          <div className="grid justify-items-center gap-4">
            <button
              type="button"
              className="group relative flex size-48 cursor-pointer items-center justify-center rounded-md bg-foreground p-2"
              onClick={() => void copyUrl()}
              disabled={!reauth.authorizationUrl}
              aria-label="Copy authorization link"
            >
              <QrCodeSlot
                isLoading={reauth.status !== 'awaiting'}
                isExpired={false}
                url={reauth.authorizationUrl}
                generatingLabel="Generating QR Code..."
                clickToReloadLabel="Click to reload"
                activeQrHasHoverEffect
              />
            </button>

            <MarketplaceApprovalDisclosure sentence={approvalDisclosure} />

            {reauth.status === 'awaiting' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin" />
                Waiting for approval on your signer…
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={reauth.openInRing}
                disabled={!reauth.authorizationUrl || reauth.isOpeningRing}
                aria-busy={reauth.isOpeningRing}
              >
                {reauth.isOpeningRing ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                {reauth.isOpeningRing
                  ? `Opening ${reauth.signerName ?? 'Pubky Ring'}...`
                  : `Open in ${reauth.signerName ?? 'Pubky Ring'}`}
              </Button>
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => void copyUrl()}
                disabled={!reauth.authorizationUrl}
              >
                <Copy className="size-4" />
                Copy link
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" className="rounded-full" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
