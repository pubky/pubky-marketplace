'use client';

import { Controller, type UseFormReturn, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import type { MarketplaceOrderActionData } from '@/hooks/useMarketplaceOrderAction/useMarketplaceOrderAction.types';
import { ControlledTextareaField } from '@/molecules/ControlledTextareaField/ControlledTextareaField';
import { MarketplaceStarRatingInput } from '@/molecules/MarketplaceStarRatingInput/MarketplaceStarRatingInput';

/**
 * The buyer's per-listing review: stars (required) and text (optional) for
 * each listing of the order, then the seller's shipping and communication,
 * rated together or not at all. Each listing becomes its own review record.
 */
export function MarketplaceReviewFields({
  form,
  showSellerRatings,
  sellerRatingsNote,
}: {
  form: UseFormReturn<MarketplaceOrderActionData>;
  /** Whether to ask for the seller ratings; false when the order already carries them. */
  showSellerRatings: boolean;
  sellerRatingsNote?: string;
}) {
  const { control } = form;
  const items = useWatch({ control, name: 'reviewItems' });
  const sellerShipping = useWatch({ control, name: 'sellerShipping' });
  const sellerCommunication = useWatch({ control, name: 'sellerCommunication' });
  const showItemTitles = items.length > 1;

  return (
    <div className="grid gap-4" data-testid="review-items">
      {items.map((item, index) => (
        <fieldset
          key={item.listingId}
          className="grid gap-3 rounded-lg border border-border/70 p-3"
          data-testid="review-item"
        >
          <legend className="px-1 text-sm font-medium text-foreground">
            {showItemTitles ? item.title : 'Rate this item'}
          </legend>
          <Controller
            name={`reviewItems.${index}.rating`}
            control={control}
            render={({ field, fieldState }) => (
              <MarketplaceStarRatingInput
                label={`Rating for ${item.title}`}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <ControlledTextareaField
            name={`reviewItems.${index}.text`}
            control={control}
            label={`Review of ${item.title} (optional)`}
            rows={3}
          />
        </fieldset>
      ))}
      {showSellerRatings ? (
        <fieldset className="grid gap-3 rounded-lg border border-border/70 p-3" data-testid="review-seller-ratings">
          <legend className="px-1 text-sm font-medium text-foreground">How was the seller? (optional)</legend>
          <Controller
            name="sellerShipping"
            control={control}
            render={({ field }) => (
              <MarketplaceStarRatingInput label="Shipping" value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            name="sellerCommunication"
            control={control}
            render={({ field, fieldState }) => (
              <MarketplaceStarRatingInput
                label="Communication"
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          {(sellerShipping !== '' || sellerCommunication !== '') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit rounded-full"
              onClick={() => {
                form.setValue('sellerShipping', '', { shouldDirty: true });
                form.setValue('sellerCommunication', '', { shouldDirty: true });
                form.clearErrors('sellerCommunication');
              }}
            >
              Clear seller ratings
            </Button>
          )}
        </fieldset>
      ) : (
        sellerRatingsNote && (
          <Typography as="p" className="text-xs text-muted-foreground" data-testid="review-seller-ratings-note">
            {sellerRatingsNote}
          </Typography>
        )
      )}
    </div>
  );
}
