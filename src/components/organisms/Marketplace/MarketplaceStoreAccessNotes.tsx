import { Link2, ShieldCheck, ShoppingBag, Unplug } from 'lucide-react';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import { CONNECTOR_PROVIDER_LABELS, type ConnectorProvider } from '@/libs/commerce/connectors';

type MarketplaceStoreAccessNotesProps = {
  provider: ConnectorProvider;
};

const DISCONNECT_REVOKE: Readonly<Record<ConnectorProvider, string>> = {
  shopify: 'Also uninstall the app in Shopify to revoke it there.',
  woocommerce: 'Also delete the key in WooCommerce under Settings, Advanced, REST API to revoke it there.',
};

/**
 * What a store connection can do, what happens on a sale, how to disconnect and
 * the buyer address note. The Shopify wording is the approved onboarding copy;
 * the WooCommerce wording changes only the store name and the revoke path.
 */
export function MarketplaceStoreAccessNotes({ provider }: MarketplaceStoreAccessNotesProps) {
  const store = CONNECTOR_PROVIDER_LABELS[provider];

  return (
    <Card className="rounded-md p-0 shadow-lg" data-testid="store-access-notes">
      <CardContent className="grid gap-6 p-6">
        <section className="grid gap-2">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              What Pubky can do with this connection
            </Heading>
          </div>
          <ul className="grid list-disc gap-1 pl-12 text-sm text-muted-foreground">
            <li>
              Read your products, stock and locations, so you can choose what to list on Pubky and keep stock in sync.
            </li>
            <li>
              Create an order in your {store} store when someone buys on Pubky. It arrives already paid, your stock goes
              down, and your usual fulfilment runs.
            </li>
            <li>Read fulfilments, so tracking reaches the buyer.</li>
          </ul>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center gap-3">
            <ShoppingBag className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              What happens on a sale
            </Heading>
          </div>
          <Typography as="p" className="pl-9 text-sm text-muted-foreground">
            When someone buys on Pubky, the order is created in your {store} store as paid, your stock goes down, and
            your usual fulfilment runs. Pubky never takes payments through {store}, and refunds go back through Pubky.
          </Typography>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center gap-3">
            <Link2 className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              Buyer addresses
            </Heading>
          </div>
          <Typography as="p" className="pl-9 text-sm text-muted-foreground">
            Buyers can choose at checkout to share their shipping address with your store. If they don&apos;t, the order
            arrives without it, and you copy the address from your Pubky orders.
          </Typography>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center gap-3">
            <Unplug className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              Disconnect
            </Heading>
          </div>
          <Typography as="p" className="pl-9 text-sm text-muted-foreground">
            Disconnect removes Pubky&apos;s access straight away. {DISCONNECT_REVOKE[provider]}
          </Typography>
        </section>
      </CardContent>
    </Card>
  );
}
