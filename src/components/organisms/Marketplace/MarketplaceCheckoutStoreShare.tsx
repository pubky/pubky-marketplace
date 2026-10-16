'use client';

import type { ConnectorShareChoice } from '@/application/commerce/commerce';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';

type MarketplaceCheckoutStoreShareProps = {
  stores: ReadonlyMap<string, ConnectorShareChoice>;
  chosen: ReadonlySet<string>;
  onChange: (sellerPubky: string, share: boolean) => void;
};

/**
 * Under the delivery address: for each shipped seller with a connected store, an
 * unticked checkbox to also seal the address to that store, so the order arrives
 * there with it. Off by default; without it the order reaches the store with no
 * address and the seller copies it from Pubky.
 */
export function MarketplaceCheckoutStoreShare({ stores, chosen, onChange }: MarketplaceCheckoutStoreShareProps) {
  if (stores.size === 0) return null;
  return (
    <div className="grid gap-3" data-testid="checkout-store-share">
      {[...stores.values()].map((store) => {
        const id = `checkout-store-share-${store.sellerPubky}`;
        return (
          <div key={store.sellerPubky} className="grid gap-1">
            <Label htmlFor={id} className="items-start gap-3">
              <Checkbox
                id={id}
                checked={chosen.has(store.sellerPubky)}
                onCheckedChange={(checked) => onChange(store.sellerPubky, checked === true)}
              />
              <span>Share my shipping address with {store.shopDomain} to fulfil this order</span>
            </Label>
            <Typography as="p" className="pl-7 text-sm text-muted-foreground">
              Your address is encrypted to the seller&apos;s store and used only to create this order there. If you
              leave this off, the seller still gets your address from Pubky.
            </Typography>
          </div>
        );
      })}
    </div>
  );
}
