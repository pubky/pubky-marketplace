'use client';

import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Heading } from '@/atoms/Heading/Heading';
import { Label } from '@/atoms/Label/Label';
import { Link } from '@/atoms/Link/Link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import { MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE } from '@/config/commerce-copy';
import type { useAuctionWinnerDeliveryAddress } from '@/hooks/useAuctionWinnerDeliveryAddress/useAuctionWinnerDeliveryAddress';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { DeliveryKeyBlockedNotice } from '@/molecules/Marketplace/DeliveryKeyBlockedNotice';
import { MarketplaceAddressFields } from '@/molecules/MarketplaceAddressFields/MarketplaceAddressFields';
import { MarketplaceDeliveryKeyChangeDialog } from '@/organisms/Marketplace/MarketplaceDeliveryKeyChangeDialog';

export type MarketplaceAuctionDeliveryAddressProps = {
  delivery: ReturnType<typeof useAuctionWinnerDeliveryAddress>;
  disabled?: boolean;
};

/**
 * Where an auction winner's order ships. The order is created when the
 * auction closes, so the address is asked for here, before a payment method,
 * and travels sealed to the seller with the method the winner picks.
 */
export function MarketplaceAuctionDeliveryAddress({
  delivery,
  disabled = false,
}: MarketplaceAuctionDeliveryAddressProps) {
  const { form, addresses, selectedAddressId } = delivery;
  return (
    <section className="grid gap-4" aria-label="Delivery address" data-testid="auction-delivery-address">
      <Heading level={3} size="sm" className="text-base font-semibold">
        Delivery address
      </Heading>
      <Typography as="p" className="text-sm text-muted-foreground">
        Auctions ship to you. Tell the seller where before you pay.
      </Typography>
      {addresses.length > 0 && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="auction-address-picker">Saved addresses</Label>
            <Link
              href={MARKETPLACE_ROUTES.SETTINGS_ADDRESSES}
              overrideDefaults
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Manage
            </Link>
          </div>
          <Select
            value={selectedAddressId ?? 'new'}
            onValueChange={(value) => delivery.selectAddress(value === 'new' ? null : value)}
            disabled={disabled}
          >
            <SelectTrigger theme="secondary" id="auction-address-picker" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {addresses.map((address) => (
                <SelectItem key={address.id} value={address.id}>
                  {address.label} · {address.city}
                  {address.is_default ? ' (default)' : ''}
                </SelectItem>
              ))}
              <SelectItem value="new">New address</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <ControlledInputField name="name" control={form.control} label="Full name" disabled={disabled} />
      <MarketplaceAddressFields control={form.control} setValue={form.setValue} disabled={disabled} />
      <Typography as="p" className="text-sm text-muted-foreground">
        {MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE}
      </Typography>
      <DeliveryKeyBlockedNotice block={delivery.deliveryKeyBlock} />
      <MarketplaceDeliveryKeyChangeDialog change={delivery.pendingKeyChange} onDecision={delivery.decideKeyChange} />
    </section>
  );
}
