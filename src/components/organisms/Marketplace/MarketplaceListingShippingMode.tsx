'use client';

import Link from 'next/link';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import {
  CREATE_MARKETPLACE_LISTING_FIELDS,
  type CreateMarketplaceListingData,
} from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing.types';
import { useMarketplaceShippingProfiles } from '@/hooks/useMarketplaceShippingProfiles/useMarketplaceShippingProfiles';
import { type ListingShippingMode } from '@/libs/commerce/listing-shipping';
import { assetForListingCurrency } from '@/libs/commerce/pricing';
import { shippingProfileFitsAsset } from '@/libs/commerce/shipping-profile';
import { emptyShippingZone } from '@/libs/commerce/shipping-zones-form';
import { MarketplaceShippingZonesEditor } from '@/organisms/Marketplace/MarketplaceShippingZonesEditor';

const MODE_LABELS: Record<ListingShippingMode, string> = {
  flat: 'One flat price for every destination',
  profile: 'Use a shipping profile (prices by destination country)',
  custom: 'Set prices by country for this listing only',
};

type Props = {
  form: UseFormReturn<CreateMarketplaceListingData>;
  isPublishing: boolean;
  /** Auctions price shipping as one flat amount. */
  zonesAllowed: boolean;
};

/**
 * The shipping-rates choice of a shipped listing: the single flat option, a
 * shared profile, or zones of this listing's own. The flat fields themselves
 * stay with the listing form; this renders the mode picker and the
 * profile and zone controls.
 */
export function MarketplaceListingShippingMode({ form, isPublishing, zonesAllowed }: Props) {
  const mode = useWatch({ control: form.control, name: CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_MODE });
  const profileId = useWatch({ control: form.control, name: CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_PROFILE });
  const zones = useWatch({ control: form.control, name: CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_ZONES });
  const currency = useWatch({ control: form.control, name: CREATE_MARKETPLACE_LISTING_FIELDS.CURRENCY });
  const asset = assetForListingCurrency(currency);
  const { state } = useMarketplaceShippingProfiles();
  const profiles = state.status === 'ready' ? state.profiles : [];
  const usable = profiles.filter(({ record }) => shippingProfileFitsAsset(record, asset));
  const named = profiles.find(({ record }) => record.profileId === profileId);
  const error = form.formState.errors.shippingProfileId?.message ?? form.formState.errors.shippingMode?.message;

  const chooseMode = (next: ListingShippingMode) => {
    form.setValue(CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_MODE, next, { shouldDirty: true });
    if (next === 'custom' && form.getValues(CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_ZONES).length === 0) {
      form.setValue(CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_ZONES, [
        emptyShippingZone({ restOfWorld: true, name: 'Worldwide' }),
      ]);
    }
  };

  return (
    <div className="grid gap-5">
      <Container className="gap-2">
        <Label htmlFor="listing-shipping-mode" className={FORM_LABEL_CLASSES}>
          Shipping rates
        </Label>
        <Select
          value={zonesAllowed ? mode : 'flat'}
          disabled={isPublishing || !zonesAllowed}
          onValueChange={(next) => chooseMode(next as ListingShippingMode)}
        >
          <SelectTrigger theme="dashed" id="listing-shipping-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as ListingShippingMode[]).map((key) => (
              <SelectItem key={key} value={key}>
                {MODE_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!zonesAllowed && (
          <Typography as="p" className="text-xs text-muted-foreground">
            Auctions use one flat shipping price.
          </Typography>
        )}
      </Container>

      {zonesAllowed && mode === 'profile' && (
        <Container className="gap-2">
          <Label htmlFor="listing-shipping-profile" className={FORM_LABEL_CLASSES}>
            Shipping profile
          </Label>
          <Select
            value={profileId === '' ? undefined : profileId}
            disabled={isPublishing || state.status !== 'ready'}
            onValueChange={(next) =>
              form.setValue(CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_PROFILE, next, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger theme="dashed" id="listing-shipping-profile">
              <SelectValue placeholder={state.status === 'loading' ? 'Loading profiles' : 'Choose a profile'} />
            </SelectTrigger>
            <SelectContent>
              {usable.map(({ record }) => (
                <SelectItem key={record.profileId} value={record.profileId}>
                  {record.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {named !== undefined && !shippingProfileFitsAsset(named.record, asset) && (
            <Typography as="p" className="text-sm text-destructive" role="alert">
              &quot;{named.record.name}&quot; prices in {named.record.currency}, but this listing is priced in{' '}
              {asset.currency}. Choose a profile in {asset.currency}.
            </Typography>
          )}
          {state.status === 'ready' && usable.length === 0 && (
            <Typography as="p" className="text-sm text-muted-foreground">
              You have no shipping profile in {asset.currency}.{' '}
              <Link href={MARKETPLACE_ROUTES.SETTINGS_SHIPPING} className="underline">
                Create one in your shipping settings
              </Link>
              .
            </Typography>
          )}
          {error && (
            <Typography as="p" className="text-sm text-destructive" role="alert">
              {error}
            </Typography>
          )}
        </Container>
      )}

      {zonesAllowed && mode === 'custom' && (
        <>
          <MarketplaceShippingZonesEditor
            idPrefix="listing-shipping"
            zones={zones}
            asset={asset}
            disabled={isPublishing}
            onChange={(next) =>
              form.setValue(CREATE_MARKETPLACE_LISTING_FIELDS.SHIPPING_ZONES, next, { shouldDirty: true })
            }
          />
          {form.formState.errors.shippingZoneValues?.message && (
            <Typography as="p" className="text-sm text-destructive" role="alert">
              {form.formState.errors.shippingZoneValues.message}
            </Typography>
          )}
        </>
      )}
    </div>
  );
}
