'use client';

import { Check, Copy, LoaderCircle } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import type { BuyerPaykitWalletState } from '@/hooks/useBuyerPaykitWallet/useBuyerPaykitWallet';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard/useCopyToClipboard';
import { BITCOIN_WALLET_UNSUPPORTED_TITLE, bitcoinWalletUnsupportedBody } from '@/libs/commerce/paykit-wallet';
import { BitkitDownloads } from '@/molecules/BitkitDownloads/BitkitDownloads';

type MarketplaceBuyerBitkitConnectDialogProps = {
  open: boolean;
  buyerPubky: string;
  state: BuyerPaykitWalletState;
  canPayWithPaypal: boolean;
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
};

/** Buyer identity setup happens in Bitkit; this dialog verifies that account's payment receiver. */
export function MarketplaceBuyerBitkitConnectDialog({
  open,
  buyerPubky,
  state,
  canPayWithPaypal,
  onOpenChange,
  onRecheck,
}: MarketplaceBuyerBitkitConnectDialogProps) {
  const { copyToClipboard } = useCopyToClipboard();
  const connected = state === 'payable';
  const unsupported = state === 'unsupported';
  const checking = state === 'checking';
  const unverified = state === 'unknown' || state === 'unverified';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg" aria-describedby="buyer-bitkit-description">
        <DialogHeader>
          <DialogTitle>Connect Bitkit</DialogTitle>
          <DialogDescription id="buyer-bitkit-description">
            Use your marketplace pubky in Bitkit to receive payment requests.
          </DialogDescription>
        </DialogHeader>

        {!connected && !unsupported && (
          <>
            <BitkitDownloads compact />
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              <li>Open Bitkit on your phone and tap your profile.</li>
              <li>Tap Continue if prompted, then choose the pubky below.</li>
              <li>Keep Bitkit open to finish connecting, then return here.</li>
            </ol>
          </>
        )}

        <div className="grid min-w-0 gap-2 rounded-md border px-4 pt-2 pb-4">
          <div className="flex items-center justify-between gap-3">
            <Typography as="p" className="text-xs text-muted-foreground">
              Your pubky
            </Typography>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copy pubky"
              onClick={() => void copyToClipboard(buyerPubky)}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
          <Typography as="p" className="font-mono text-xs break-all" data-testid="buyer-bitkit-account">
            {buyerPubky}
          </Typography>
        </div>

        {!connected && !unsupported && (
          <Typography as="p" className="text-xs text-muted-foreground">
            Is your pubky not listed? Make sure this pubky is in Pubky Ring on the same phone. If Bitkit uses another
            pubky, it won’t connect to this checkout.
          </Typography>
        )}

        {(connected || unsupported || checking || unverified) && (
          <div role="status" aria-live="polite" className="grid gap-2 text-sm">
            {connected ? (
              <Typography as="p" className="flex items-center gap-2 text-brand">
                <Check className="size-4" aria-hidden="true" />
                Bitkit is connected. You can continue checkout.
              </Typography>
            ) : unsupported ? (
              <>
                <Typography as="p" className="font-medium">
                  {BITCOIN_WALLET_UNSUPPORTED_TITLE}
                </Typography>
                <Typography as="p" className="text-xs text-muted-foreground">
                  {bitcoinWalletUnsupportedBody(canPayWithPaypal)}
                </Typography>
              </>
            ) : checking ? (
              <Typography as="p" className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Checking connection…
              </Typography>
            ) : (
              <Typography as="p" className="text-muted-foreground">
                Couldn’t check the connection. Try again.
              </Typography>
            )}
          </div>
        )}

        <DialogFooter>
          {!connected && !unsupported && (
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {connected || unsupported ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {connected ? 'Continue checkout' : 'Back to checkout'}
            </Button>
          ) : (
            <Button type="button" disabled={checking || state === 'idle'} onClick={onRecheck}>
              Check connection
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
