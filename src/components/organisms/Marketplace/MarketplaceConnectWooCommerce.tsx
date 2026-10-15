'use client';

import { ChevronDown, KeyRound, LoaderCircle, ShoppingCart } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/atoms/Collapsible/Collapsible';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import type { useConnectionStatusCheck } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import type { UseConnectWooCommerceResult } from '@/hooks/useConnectWooCommerce/useConnectWooCommerce';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { MarketplaceConnectionStatusCheck } from './MarketplaceConnectionStatusCheck';

type MarketplaceConnectWooCommerceProps = {
  woo: UseConnectWooCommerceResult;
  statusCheck: ReturnType<typeof useConnectionStatusCheck>;
  onCheck: () => void;
  /** Set when the seller came back from the store's approval screen. */
  returnNotice?: { approved: boolean } | null;
};

/**
 * Connect a WooCommerce store: the store address, then WooCommerce's own
 * approval screen. Pasting a REST key pair is the fallback for stores that
 * block that screen.
 */
export function MarketplaceConnectWooCommerce({
  woo,
  statusCheck,
  onCheck,
  returnNotice = null,
}: MarketplaceConnectWooCommerceProps) {
  const { oneClickForm, keysForm, isWorking } = woo;
  const showStatus = statusCheck.phase !== 'idle';

  return (
    <Card
      className="rounded-md p-0 shadow-lg"
      data-surface="store-connect-woocommerce"
      data-testid="connect-woocommerce"
    >
      <CardContent className="grid gap-6 p-6">
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <ShoppingCart className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              Connect your WooCommerce store
            </Heading>
          </div>
          <Typography as="p" className="text-sm text-muted-foreground">
            Enter your store address. WooCommerce asks you to approve Pubky on your own store, and sends the keys
            straight to Pubky. Pubky never sees your WordPress password, and you can disconnect at any time.
          </Typography>
        </div>

        {returnNotice && !returnNotice.approved && (
          <Typography
            as="p"
            className="rounded-md border border-dashed border-border p-3 text-sm"
            data-testid="woo-declined"
          >
            WooCommerce did not approve the connection, so nothing was connected. Start again when you are ready.
          </Typography>
        )}

        <form
          className="grid gap-3"
          data-testid="woo-one-click-form"
          onSubmit={(event) => {
            event.preventDefault();
            void woo.startOneClick();
          }}
        >
          <ControlledInputField
            name="storeUrl"
            control={oneClickForm.control}
            label="Store address"
            placeholder="shop.example.com"
            autoComplete="off"
          />
          <Typography as="p" className="text-sm text-muted-foreground">
            You need a WordPress admin account that can manage WooCommerce. WooCommerce asks for read and write access:
            Pubky needs write to create orders in your store.
          </Typography>
          <Button type="submit" className="w-fit rounded-full" disabled={isWorking}>
            {isWorking && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Connect WooCommerce
          </Button>
        </form>

        {showStatus && (
          <div className="border-t border-dashed border-border pt-4">
            <MarketplaceConnectionStatusCheck
              phase={statusCheck.phase}
              result={statusCheck.result}
              onCheck={onCheck}
              storeLabel="WooCommerce"
            />
          </div>
        )}

        <Collapsible>
          <CollapsibleTrigger className="group flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown
              className="size-4 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
            Paste REST keys instead
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-3 pt-4 text-sm text-muted-foreground data-[state=closed]:hidden">
            <Typography as="p">
              Use this if your store blocks the approval screen. In WordPress, open{' '}
              <strong className="text-foreground">WooCommerce → Settings → Advanced → REST API</strong>, click{' '}
              <strong className="text-foreground">Add key</strong>, choose{' '}
              <strong className="text-foreground">Read/Write</strong>, and paste the keys here. They are sent securely
              to Pubky and stored encrypted. Pubky never shows them again.
            </Typography>
            <form
              className="grid gap-3"
              data-testid="woo-keys-form"
              onSubmit={(event) => {
                event.preventDefault();
                void woo.submitKeys();
              }}
            >
              <ControlledInputField
                name="storeUrl"
                control={keysForm.control}
                label="Store address"
                placeholder="shop.example.com"
                autoComplete="off"
              />
              <ControlledInputField
                name="consumerKey"
                control={keysForm.control}
                label="Consumer key"
                type="password"
                autoComplete="off"
              />
              <ControlledInputField
                name="consumerSecret"
                control={keysForm.control}
                label="Consumer secret"
                type="password"
                autoComplete="off"
              />
              <Button type="submit" variant="secondary" className="w-fit rounded-full" disabled={isWorking}>
                {isWorking ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="size-4" aria-hidden="true" />
                )}
                Save keys
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
