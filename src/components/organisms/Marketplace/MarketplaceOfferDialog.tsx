'use client';

import { useState } from 'react';
import { HandCoins } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import { useBuyerCountry } from '@/hooks/useBuyerCountry/useBuyerCountry';
import { useCommerceAvailability } from '@/hooks/useCommerceAvailability/useCommerceAvailability';
import { useMarketplaceOffer } from '@/hooks/useMarketplaceOffer/useMarketplaceOffer';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { formatCommerceMoney } from '@/libs/commerce/format';
import {
  AMOUNT_EXAMPLES,
  amountInputExample,
  amountInputUnitLabel,
  type CommerceAsset,
  tryAmountInputToMoney,
} from '@/libs/commerce/pricing';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { getEuFenceEnabled } from '@/libs/runtime-config/runtime-config';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { ControlledTextareaField } from '@/molecules/ControlledTextareaField/ControlledTextareaField';
import { BuyerCountryField } from '@/molecules/Marketplace/BuyerCountryField';

export function MarketplaceOfferDialog({
  aggregateId,
  expectedRevision,
  priceAsset,
  askingPrice = null,
  isSessionRequired = false,
  onSessionRequired,
  onAccepted,
  isOwner = false,
  holdDisabled = false,
  holdLabel,
  regionHeld = false,
}: {
  aggregateId: string;
  expectedRevision: number | null;
  /** The listing's own pricing asset — offers are made in it, never converted. */
  priceAsset: CommerceAsset;
  askingPrice?: CommerceMoney | null;
  isSessionRequired?: boolean;
  onSessionRequired?: () => void;
  onAccepted: () => void | Promise<void>;
  isOwner?: boolean;
  holdDisabled?: boolean;
  holdLabel?: string;
  /** Commerce is blocked for this listing (its seller's country); the visitor's own region is read here. */
  regionHeld?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const commerce = useCommerceAvailability();
  const commerceHeld = regionHeld || commerce.held;
  // `onAccepted` refreshes the projection, which is exactly the recovery a
  // revision conflict needs: reload the terms/revision, then the user re-offers.
  const offer = useMarketplaceOffer(aggregateId, expectedRevision, onAccepted, priceAsset, isOwner);
  const { requireAuth } = useRequireAuth();
  const amount = offer.form.watch('amount');
  const comparableAsking = askingPriceComparableToAsset(askingPrice, priceAsset);
  const askingPriceLine = formatAskingPriceLine(comparableAsking);
  const comparisonLine = formatOfferComparisonLine(amount, comparableAsking, priceAsset);

  const buyer = useBuyerCountry();
  const showsCountry = getEuFenceEnabled();
  const needsCountry = showsCountry && buyer.country === null;
  const submit = async () => {
    if (!(await offer.submit())) return;
    setOpen(false);
    offer.reset();
    await onAccepted();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOpen(false);
          return;
        }
        if (isSessionRequired) {
          requireAuth(() => onSessionRequired?.());
          return;
        }
        if (holdDisabled || commerceHeld) return;
        requireAuth(() => setOpen(true));
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="default"
          variant="secondary"
          className="w-fit rounded-full"
          disabled={isOwner || holdDisabled || commerceHeld || (expectedRevision === null && !isSessionRequired)}
        >
          <HandCoins className="size-4" />
          {isOwner ? 'You cannot buy your own listing' : holdDisabled ? (holdLabel ?? 'Held') : 'Make offer'}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover">
        <DialogHeader>
          <DialogTitle>Make a private offer</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <ControlledInputField
            name="amount"
            control={offer.form.control}
            label={`Offer amount (${amountInputUnitLabel(priceAsset)})`}
            placeholder={amountInputExample(priceAsset, AMOUNT_EXAMPLES.offer)}
          />
          {(askingPriceLine || comparisonLine) && (
            <div className="-mt-2 grid gap-1">
              {askingPriceLine && (
                <Typography as="p" className="text-sm text-muted-foreground">
                  {askingPriceLine}
                </Typography>
              )}
              {comparisonLine && (
                <Typography as="p" className="text-sm text-brand">
                  {comparisonLine}
                </Typography>
              )}
            </div>
          )}
          <ControlledInputField name="quantity" control={offer.form.control} label="Quantity" placeholder="1" />
          <ControlledTextareaField
            name="message"
            control={offer.form.control}
            label="Message (optional)"
            placeholder="Add context for the seller"
            rows={4}
          />
        </div>
        {showsCountry && (
          <BuyerCountryField value={buyer.country} onChange={buyer.setCountry} id="dialog-buyer-country" />
        )}
        <DialogFooter>
          <Button variant="secondary" className="rounded-full" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={needsCountry}>
            Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function askingPriceComparableToAsset(
  askingPrice: CommerceMoney | null,
  priceAsset: CommerceAsset,
): CommerceMoney | null {
  if (!askingPrice || askingPrice.currency !== priceAsset.currency) return null;
  return askingPrice;
}

function formatAskingPriceLine(askingPrice: CommerceMoney | null): string | null {
  return askingPrice ? `Asking price: ${formatCommerceMoney(askingPrice)}` : null;
}

function formatOfferComparisonLine(
  amount: string,
  askingPrice: CommerceMoney | null,
  priceAsset: CommerceAsset,
): string | null {
  if (!askingPrice || askingPrice.amountMinor <= 0 || amount.trim() === '') return null;

  const offerAmount = tryAmountInputToMoney(amount, priceAsset);
  if (offerAmount === null || offerAmount.amountMinor <= 0) return null;

  const difference = offerAmount.amountMinor - askingPrice.amountMinor;
  if (difference === 0) return 'Matches asking';

  const percent = Math.max(1, Math.round((Math.abs(difference) / askingPrice.amountMinor) * 100));
  return `${percent}% ${difference < 0 ? 'below' : 'above'} asking`;
}
