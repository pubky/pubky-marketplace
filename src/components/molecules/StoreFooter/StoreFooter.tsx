'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { getStoreSeller } from '@/config/store-mode';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard/useCopyToClipboard';
import { useStoreShop } from '@/hooks/useStoreShop/useStoreShop';
import { formatPublicKey, withPubkyPrefix } from '@/libs/utils/utils';

/** Long enough that a look-alike key differs visibly at both ends, short enough for one line. */
const STORE_SELLER_KEY_DISPLAY_LENGTH = 16;

/**
 * A store's footer: who runs the software, who sells here (the shop's name from the seller's shop
 * record) and the seller's pubky in a short form a buyer can copy and compare, so a look-alike
 * store on another domain shows a different key. The shop record has no terms or contact field, so
 * the footer links neither. Renders nothing outside a store.
 */
export function StoreFooter() {
  const storeSeller = getStoreSeller();
  const { copyToClipboard } = useCopyToClipboard({ successTitle: "Seller's pubky copied to clipboard" });
  const shopName = useStoreShop()?.record.name.trim();
  if (storeSeller === null) return null;

  const pubky = withPubkyPrefix(storeSeller);

  return (
    <footer
      aria-label="Store"
      data-testid="store-footer"
      className="mt-12 flex flex-col items-center gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between"
    >
      <Typography as="p" size="sm" className="text-muted-foreground">
        Powered by Pubky Market
      </Typography>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
        <Typography as="span" size="sm" className="max-w-full truncate text-muted-foreground">
          {shopName ? (
            <>
              Sold by <span className="font-medium text-foreground">{shopName}</span>
            </>
          ) : (
            'Seller'
          )}
        </Typography>
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full font-mono"
          aria-label={`Copy the seller's pubky, ${pubky}`}
          title={pubky}
          onClick={() => void copyToClipboard(pubky)}
        >
          {formatPublicKey({ key: storeSeller, length: STORE_SELLER_KEY_DISPLAY_LENGTH, includePrefix: true })}
          <Copy className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </footer>
  );
}
